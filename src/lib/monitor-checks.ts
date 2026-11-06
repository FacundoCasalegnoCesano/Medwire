import "server-only";

import { randomUUID } from "node:crypto";
import { fromPrisma } from "pg-boss";
import type { CheckRun, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { assertWorkspaceCapability, resolveWorkspaceEntitlement } from "@/lib/beta-policy";
import { compareOpenApiDocuments } from "@/lib/openapi-diff";
import { fetchMonitorContract, type FetchedOpenApiContract } from "@/lib/monitor-sources";
import { getMonitorCheckBoss, MONITOR_CHECK_QUEUE } from "@/lib/monitor-queue";
import { MonitorNotFoundError, MonitorConflictError } from "@/lib/monitor-errors";
import { summarizeCheckRun, summarizeImpactAnalysis, type CheckFinding, type CheckRunSummary } from "@/lib/monitor-check-types";

const CLAIM_LEASE_MS = 2 * 60_000;
const FAILURE_MESSAGES = {
  fetch: "The OpenAPI source could not be fetched or validated. The last valid baseline was kept.",
  compare: "The OpenAPI comparison could not be completed. The last valid baseline was kept; retry to compare the saved revision.",
  stale: "The monitor changed while this check was running. Start a new check for the current contract.",
  withdrawn: "This monitor is withdrawn and the check was not run.",
  policy: "The workspace no longer allows checks. The last valid baseline was kept.",
} as const;

export class MonitorCheckError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 429 | 503, message: string, readonly availableAt: Date | null = null) {
    super(message);
  }
}

type QueueTransaction = Prisma.TransactionClient;
type CheckDependencies = {
  fetchContract?: (contractUrl: string) => Promise<FetchedOpenApiContract>;
  compare?: (previous: unknown, current: unknown) => Promise<CheckFinding[]>;
  leaseMs?: number;
};

function cleanKey(value: string) {
  return value.length >= 8 && value.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function toSummary(run: CheckRun): CheckRunSummary {
  return summarizeCheckRun(run);
}

async function enqueueInTransaction(tx: QueueTransaction, runId: string) {
  const boss = await getMonitorCheckBoss();
  await boss.send(MONITOR_CHECK_QUEUE, { runId }, {
    id: randomUUID(),
    singletonKey: runId,
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    db: fromPrisma(tx),
  });
}

async function loadOwnedMonitor(monitorId: string) {
  const { requireWorkspace } = await import("@/lib/workspace");
  const workspace = await requireWorkspace();
  const monitor = await db.monitor.findFirst({
    where: { id: monitorId, workspaceId: workspace.id },
    include: { workspace: { select: { id: true, ownerId: true } } },
  });
  if (!monitor) throw new MonitorNotFoundError();
  return monitor;
}

export async function enqueueManualCheck(monitorId: string, idempotencyKey: string): Promise<CheckRunSummary> {
  if (!cleanKey(idempotencyKey)) throw new MonitorCheckError(409, "Send a valid Idempotency-Key for this check.");
  const monitor = await loadOwnedMonitor(monitorId);
  const existing = await db.checkRun.findUnique({ where: { monitorId_idempotencyKey: { monitorId, idempotencyKey } } });
  if (existing) return toSummary(existing);

  const entitlement = await assertWorkspaceCapability({
    workspaceId: monitor.workspace.id,
    actorUserId: monitor.workspace.ownerId,
    capability: "run-check",
  });
  if (monitor.status !== "READY") throw new MonitorCheckError(409, "Validate and activate the monitor before running a check.");

  const runId = randomUUID();
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe("SELECT \"id\" FROM \"Monitor\" WHERE \"id\" = $1 FOR UPDATE", monitorId);
      const currentMonitor = await tx.monitor.findFirst({ where: { id: monitorId }, include: { workspace: { select: { id: true, ownerId: true } } } });
      if (!currentMonitor || currentMonitor.workspace.id !== monitor.workspace.id) throw new MonitorNotFoundError();
      if (currentMonitor.status !== "READY" || currentMonitor.contractVersion !== monitor.contractVersion || currentMonitor.contractUrl !== monitor.contractUrl) {
        throw new MonitorConflictError();
      }
      await assertWorkspaceCapability({ workspaceId: currentMonitor.workspace.id, actorUserId: currentMonitor.workspace.ownerId, capability: "run-check" });
      const repeated = await tx.checkRun.findUnique({ where: { monitorId_idempotencyKey: { monitorId, idempotencyKey } } });
      if (repeated) return toSummary(repeated);
      const [active, latestManual, retryable] = await Promise.all([
        tx.checkRun.findFirst({ where: { monitorId, status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } }),
        tx.checkRun.findFirst({ where: { monitorId, trigger: "MANUAL", contractVersion: currentMonitor.contractVersion }, orderBy: { queuedAt: "desc" }, select: { queuedAt: true } }),
        tx.checkRun.findFirst({
          where: { monitorId, contractVersion: currentMonitor.contractVersion, status: "FAILURE", newSnapshotId: { not: null }, previousSnapshotId: { not: null } },
          orderBy: { queuedAt: "desc" },
        }),
      ]);
      if (active) throw new MonitorCheckError(409, "A check is already queued or running.");
      const cooldownUntil = latestManual ? new Date(latestManual.queuedAt.getTime() + entitlement.manualCheckCooldownSeconds * 1_000) : null;
      if (cooldownUntil && cooldownUntil > new Date()) throw new MonitorCheckError(429, "Wait until the manual check cooldown ends.", cooldownUntil);
      const retry = retryable?.newSnapshotId && retryable.previousSnapshotId &&
        retryable.previousRevisionId === (currentMonitor.currentRevisionId
          ? (await tx.contractSnapshot.findUnique({ where: { id: currentMonitor.currentRevisionId }, select: { revisionId: true } }))?.revisionId
          : null)
        ? retryable
        : null;
      const run = await tx.checkRun.create({
        data: {
          id: runId,
          monitorId,
          contractVersion: currentMonitor.contractVersion,
          contractUrl: currentMonitor.contractUrl,
          trigger: "MANUAL",
          idempotencyKey,
          ...(retry ? {
            previousRevisionId: retry.previousRevisionId,
            newRevisionId: retry.newRevisionId,
            previousSnapshotId: retry.previousSnapshotId,
            newSnapshotId: retry.newSnapshotId,
          } : {}),
        },
      });
      await enqueueInTransaction(tx, run.id);
      return toSummary(run);
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof MonitorNotFoundError || error instanceof MonitorConflictError || error instanceof MonitorCheckError) throw error;
    const duplicate = await db.checkRun.findUnique({ where: { monitorId_idempotencyKey: { monitorId, idempotencyKey } } });
    if (duplicate) return toSummary(duplicate);
    if (error instanceof Error && (error as { code?: string }).code === "P2002") {
      throw new MonitorCheckError(409, "A check is already queued or running.");
    }
    throw new MonitorCheckError(503, "The check could not be queued. Try again.");
  }
}

const CHECK_HISTORY_PAGE_SIZE = 50;

export function encodeCheckRunCursor(monitorId: string, run: { id: string; queuedAt: Date }) {
  return Buffer.from(JSON.stringify({ monitorId, queuedAt: run.queuedAt.toISOString(), id: run.id })).toString("base64url");
}

export function decodeCheckRunCursor(cursor: string, monitorId: string): { id: string; queuedAt: Date } | null {
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { monitorId?: unknown; queuedAt?: unknown; id?: unknown };
    if (value.monitorId !== monitorId || typeof value.id !== "string" || value.id.length < 1 || value.id.length > 128 ||
      typeof value.queuedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.queuedAt)) return null;
    const queuedAt = new Date(value.queuedAt);
    return Number.isNaN(queuedAt.getTime()) || queuedAt.toISOString() !== value.queuedAt ? null : { id: value.id, queuedAt };
  } catch {
    return null;
  }
}

export async function listCheckRuns(monitorId: string, cursor?: string): Promise<{ runs: CheckRunSummary[]; nextCursor: string | null; hasMore: boolean }> {
  const monitor = await loadOwnedMonitor(monitorId);
  await resolveWorkspaceEntitlement({ workspaceId: monitor.workspace.id, actorUserId: monitor.workspace.ownerId });
  const after = cursor === undefined ? null : decodeCheckRunCursor(cursor, monitorId);
  if (cursor !== undefined && !after) throw new MonitorCheckError(400, "The check history cursor is invalid.");
  const runs = await db.checkRun.findMany({
    where: { monitorId, ...(after ? { OR: [
      { queuedAt: { lt: after.queuedAt } },
      { queuedAt: after.queuedAt, id: { lt: after.id } },
    ] } : {}) },
    orderBy: [{ queuedAt: "desc" }, { id: "desc" }], take: CHECK_HISTORY_PAGE_SIZE + 1,
    include: { impactAnalysis: true },
  });
  const hasMore = runs.length > CHECK_HISTORY_PAGE_SIZE;
  const pageRuns = runs.slice(0, CHECK_HISTORY_PAGE_SIZE);
  return { runs: pageRuns.map((run) => summarizeCheckRun({
    ...run,
    impactAnalysis: run.impactAnalysis ? summarizeImpactAnalysis(run.impactAnalysis) : null,
  })), nextCursor: hasMore ? encodeCheckRunCursor(monitorId, pageRuns.at(-1)!) : null, hasMore };
}

async function claimRun(runId: string, leaseMs: number) {
  const now = new Date();
  const token = randomUUID();
  return db.$transaction(async (tx) => {
    const claimed = await tx.checkRun.updateMany({
      where: { id: runId, OR: [{ status: "QUEUED" }, { status: "RUNNING", leaseExpiresAt: { lte: now } }] },
      data: { status: "RUNNING", claimToken: token, leaseExpiresAt: new Date(now.getTime() + leaseMs), startedAt: now, attempts: { increment: 1 }, error: null },
    });
    if (!claimed.count) return null;
    const run = await tx.checkRun.findUnique({ where: { id: runId }, include: { monitor: { include: { workspace: { select: { id: true, ownerId: true } } } } } });
    return run ? { run, token } : null;
  });
}

async function recordFailure(runId: string, token: string, message: string) {
  await db.$transaction(async (tx) => {
    const run = await tx.checkRun.findFirst({ where: { id: runId, claimToken: token } });
    if (!run) return;
    const monitor = await tx.monitor.findUnique({ where: { id: run.monitorId }, select: { status: true, contractVersion: true, contractUrl: true } });
    const failureMessage = monitor?.status === "WITHDRAWN"
      ? FAILURE_MESSAGES.withdrawn
      : !monitor || monitor.status !== "READY" || monitor.contractVersion !== run.contractVersion || monitor.contractUrl !== run.contractUrl
        ? FAILURE_MESSAGES.stale
        : message;
    await tx.checkRun.updateMany({
      where: { id: runId, claimToken: token },
      data: {
        status: "FAILURE", error: failureMessage, completedAt: new Date(), leaseExpiresAt: null, claimToken: null,
      },
    });
  });
}

export async function processMonitorCheckRun(runId: string, dependencies: CheckDependencies = {}): Promise<void> {
  const claimed = await claimRun(runId, dependencies.leaseMs ?? CLAIM_LEASE_MS);
  if (!claimed) return;
  const { run, token } = claimed;
  const monitor = run.monitor;
  const deps = dependencies;
  let entitlement: Awaited<ReturnType<typeof assertWorkspaceCapability>> | null = null;
  try {
    entitlement = await assertWorkspaceCapability({ workspaceId: monitor.workspace.id, actorUserId: monitor.workspace.ownerId, capability: "run-check" });
  } catch {
    entitlement = null;
  }
  if (monitor.status !== "READY" || monitor.contractVersion !== run.contractVersion || monitor.contractUrl !== run.contractUrl) {
    await recordFailure(runId, token, monitor.status === "WITHDRAWN" ? FAILURE_MESSAGES.withdrawn : FAILURE_MESSAGES.stale);
    return;
  }
  if (!entitlement) {
    await recordFailure(runId, token, FAILURE_MESSAGES.policy);
    return;
  }

  const currentSnapshot = monitor.currentRevisionId
    ? await db.contractSnapshot.findUnique({ where: { id: monitor.currentRevisionId } })
    : null;
  let previousSnapshotId = run.previousSnapshotId ?? currentSnapshot?.id ?? null;
  let previousRevisionId = run.previousRevisionId ?? currentSnapshot?.revisionId ?? null;
  let fetched: FetchedOpenApiContract | null = null;
  let newSnapshotId = run.newSnapshotId;
  let newRevisionId = run.newRevisionId;
  let previousSnapshot = previousSnapshotId ? await db.contractSnapshot.findUnique({ where: { id: previousSnapshotId } }) : null;
  let previousDocument: unknown = previousSnapshot?.document ?? null;
  let currentDocument: unknown = null;

  if (run.newSnapshotId) {
    const saved = await db.contractSnapshot.findUnique({ where: { id: run.newSnapshotId } });
    if (!saved) {
      await recordFailure(runId, token, FAILURE_MESSAGES.compare);
      return;
    }
    currentDocument = saved.document;
    newRevisionId = saved.revisionId;
  } else {
    try {
      fetched = await (deps.fetchContract ?? fetchMonitorContract)(run.contractUrl);
    } catch {
      await recordFailure(runId, token, FAILURE_MESSAGES.fetch);
      return;
    }
    newRevisionId = fetched.revisionId;
    if (currentSnapshot && currentSnapshot.revisionId === fetched.revisionId) {
      await finalizeRun({
        runId, token, monitorId: monitor.id, contractVersion: run.contractVersion, contractUrl: run.contractUrl,
        outcome: "UNCHANGED", findings: [], previousRevisionId: currentSnapshot.revisionId,
        newRevisionId: currentSnapshot.revisionId, previousSnapshotId: currentSnapshot.id, newSnapshotId: currentSnapshot.id,
        currentRevisionId: currentSnapshot.id, frequencyHours: entitlement.limits.checkFrequencyHours,
      });
      return;
    }
    const persisted = await saveFetchedTransition({ runId, token, monitorId: monitor.id, contractVersion: run.contractVersion, contractUrl: run.contractUrl, previousSnapshotId, previousRevisionId, fetched });
    if (!persisted) return;
    newSnapshotId = persisted.snapshot.id;
    previousSnapshotId = persisted.previousSnapshotId;
    previousRevisionId = persisted.previousRevisionId;
    previousSnapshot = persisted.previousSnapshot;
    previousDocument = previousSnapshot?.document ?? null;
    currentDocument = fetched.document;
  }

  let findings: CheckFinding[] = [];
  let outcome: "BASELINE_SAVED" | "NO_CHANGES" | "CHANGES_FOUND";
  if (!previousSnapshotId || previousDocument === null) {
    outcome = "BASELINE_SAVED";
  } else {
    try {
      findings = await (deps.compare ?? compareOpenApiDocuments)(previousDocument, currentDocument);
    } catch {
      await recordFailure(runId, token, FAILURE_MESSAGES.compare);
      return;
    }
    outcome = findings.length ? "CHANGES_FOUND" : "NO_CHANGES";
  }

  await finalizeRun({
    runId, token, monitorId: monitor.id, contractVersion: run.contractVersion, contractUrl: run.contractUrl,
    outcome, findings, previousRevisionId, newRevisionId, previousSnapshotId, newSnapshotId,
    currentRevisionId: newSnapshotId ?? currentSnapshot?.id ?? null,
    frequencyHours: entitlement.limits.checkFrequencyHours,
  });
}

async function saveFetchedTransition(input: {
  runId: string; token: string; monitorId: string; contractVersion: number; contractUrl: string;
  previousSnapshotId: string | null; previousRevisionId: string | null; fetched: FetchedOpenApiContract;
}) {
  return db.$transaction(async (tx) => {
    const now = new Date();
    const locked = await tx.checkRun.updateMany({ where: { id: input.runId, claimToken: input.token, status: "RUNNING", leaseExpiresAt: { gt: now } }, data: { leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS) } });
    if (!locked.count) return null;
    const validMonitor = await tx.monitor.findFirst({ where: { id: input.monitorId, status: "READY", contractVersion: input.contractVersion, contractUrl: input.contractUrl }, select: { id: true } });
    if (!validMonitor) {
      await tx.checkRun.updateMany({ where: { id: input.runId, claimToken: input.token }, data: { status: "FAILURE", error: FAILURE_MESSAGES.stale, completedAt: new Date(), leaseExpiresAt: null, claimToken: null } });
      return null;
    }
    const snapshot = await tx.contractSnapshot.upsert({
      where: { monitorId_contractVersion_revisionId: { monitorId: input.monitorId, contractVersion: input.contractVersion, revisionId: input.fetched.revisionId } },
      create: { monitorId: input.monitorId, contractVersion: input.contractVersion, revisionId: input.fetched.revisionId, contractUrl: input.contractUrl, specVersion: input.fetched.specVersion, document: input.fetched.document as Prisma.InputJsonValue },
      update: {},
    });
    const updated = await tx.checkRun.updateMany({ where: { id: input.runId, claimToken: input.token, status: "RUNNING" }, data: {
      previousSnapshotId: input.previousSnapshotId, previousRevisionId: input.previousRevisionId,
      newSnapshotId: snapshot.id, newRevisionId: snapshot.revisionId,
    } });
    if (!updated.count) return null;
    const previousSnapshot = input.previousSnapshotId ? await tx.contractSnapshot.findUnique({ where: { id: input.previousSnapshotId } }) : null;
    return { snapshot, previousSnapshot, previousSnapshotId: input.previousSnapshotId, previousRevisionId: input.previousRevisionId };
  });
}

async function finalizeRun(input: {
  runId: string; token: string; monitorId: string; contractVersion: number; contractUrl: string;
  outcome: "BASELINE_SAVED" | "UNCHANGED" | "NO_CHANGES" | "CHANGES_FOUND"; findings: CheckFinding[];
  previousRevisionId: string | null; newRevisionId: string | null; previousSnapshotId: string | null; newSnapshotId: string | null;
  currentRevisionId: string | null; frequencyHours: number;
}) {
  await db.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.checkRun.updateMany({
      where: { id: input.runId, status: "RUNNING", claimToken: input.token, leaseExpiresAt: { gt: now } },
      data: { leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
    });
    if (!claimed.count) return;
    const monitorUpdated = await tx.monitor.updateMany({
      where: { id: input.monitorId, status: "READY", contractVersion: input.contractVersion, contractUrl: input.contractUrl },
      data: { currentRevisionId: input.currentRevisionId, lastSuccessfulCheckAt: now, nextCheckAt: nextDue(input.frequencyHours) },
    });
    if (!monitorUpdated.count) {
      await tx.checkRun.updateMany({ where: { id: input.runId, claimToken: input.token }, data: { status: "FAILURE", error: FAILURE_MESSAGES.stale, completedAt: now, leaseExpiresAt: null, claimToken: null } });
      return;
    }
    await tx.checkRun.updateMany({
      where: { id: input.runId, status: "RUNNING", claimToken: input.token },
      data: { status: "SUCCESS", outcome: input.outcome, previousRevisionId: input.previousRevisionId, newRevisionId: input.newRevisionId,
        previousSnapshotId: input.previousSnapshotId, newSnapshotId: input.newSnapshotId, findings: input.findings as Prisma.InputJsonValue,
        error: null, completedAt: now, leaseExpiresAt: null, claimToken: null },
    });
  });
}

function nextDue(hours: number) {
  return new Date(Date.now() + hours * 60 * 60_000);
}

export async function dispatchDueMonitorChecks(): Promise<void> {
  await recoverExpiredCheckRuns();
  const due = await db.monitor.findMany({
    where: { status: "READY", nextCheckAt: { lte: new Date() } },
    include: { workspace: { select: { id: true, ownerId: true } } },
    orderBy: { nextCheckAt: "asc" },
    take: 100,
  });
  for (const monitor of due) {
    const entitlement = await resolveWorkspaceEntitlement({ workspaceId: monitor.workspace.id, actorUserId: monitor.workspace.ownerId });
    const idempotencyKey = `scheduled:${monitor.contractVersion}:${monitor.nextCheckAt?.toISOString() ?? "now"}`;
    await db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe("SELECT \"id\" FROM \"Monitor\" WHERE \"id\" = $1 FOR UPDATE", monitor.id);
      const current = await tx.monitor.findFirst({ where: { id: monitor.id, status: "READY", contractVersion: monitor.contractVersion, nextCheckAt: monitor.nextCheckAt }, select: { id: true } });
      if (!current) return;
      const active = await tx.checkRun.findFirst({ where: { monitorId: monitor.id, status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
      if (active) {
        await tx.monitor.updateMany({ where: { id: monitor.id, status: "READY", contractVersion: monitor.contractVersion }, data: { nextCheckAt: new Date(Date.now() + 5 * 60_000) } });
        return;
      }
      const claimed = await tx.monitor.updateMany({ where: { id: monitor.id, status: "READY", contractVersion: monitor.contractVersion, nextCheckAt: monitor.nextCheckAt }, data: { nextCheckAt: new Date(Date.now() + entitlement.limits.checkFrequencyHours * 60 * 60_000) } });
      if (!claimed.count) return;
      if (!entitlement.capabilities.runCheck) return;
      const run = await tx.checkRun.create({ data: { monitorId: monitor.id, contractVersion: monitor.contractVersion, contractUrl: monitor.contractUrl, trigger: "SCHEDULED", idempotencyKey } });
      await enqueueInTransaction(tx, run.id);
    }, { isolationLevel: "Serializable" }).catch(() => undefined);
  }
}

async function recoverExpiredCheckRuns(): Promise<void> {
  const expired = await db.checkRun.findMany({
    where: { status: "RUNNING", leaseExpiresAt: { lte: new Date() } },
    select: { id: true },
    take: 100,
  });
  for (const { id } of expired) {
    await db.$transaction(async (tx) => {
      const reset = await tx.checkRun.updateMany({
        where: { id, status: "RUNNING", leaseExpiresAt: { lte: new Date() } },
        data: { status: "QUEUED", claimToken: null, leaseExpiresAt: null, startedAt: null, error: null },
      });
      if (reset.count) await enqueueInTransaction(tx, id);
    }).catch(() => undefined);
  }
}
