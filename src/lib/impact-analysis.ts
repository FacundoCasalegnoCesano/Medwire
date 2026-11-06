import "server-only";

import { randomUUID } from "node:crypto";
import { fromPrisma } from "pg-boss";
import type { ImpactAnalysis, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { assertWorkspaceCapability, PolicyDeniedError, resolveWorkspaceEntitlement } from "@/lib/beta-policy";
import { analyzeContractImpact } from "@/lib/impact-analyzer";
import { ImpactSourceError, readRepositoryFiles, resolveRepositoryRevision } from "@/lib/impact-repository";
import type { ImpactAnalysisDetail, ImpactAnalysisSummary, ImpactCoverage, ImpactEvidence } from "@/lib/impact-types";
import type { CheckFinding } from "@/lib/monitor-check-types";
import { enqueueImpactAnalysisInTransaction, getMonitorCheckBoss, MONITOR_IMPACT_ANALYSIS_QUEUE } from "@/lib/monitor-queue";

const CLAIM_LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 4;
const MAX_EVIDENCE = 200;
export const IMPACT_ANALYZER_VERSION = "impact-ts-v4";
const FAILURE_MESSAGE = "The impact analysis could not be completed. Retry it to continue on the pinned commit.";
const POLICY_MESSAGE = "The workspace no longer allows impact analysis. The check result and saved monitor were kept.";
const WITHDRAWN_MESSAGE = "This monitor is withdrawn and the impact analysis was not published.";
const STALE_MESSAGE = "The monitor source or contract changed while this impact analysis was running. Request a new analysis for the current source.";
const SNAPSHOT_MESSAGE = "The saved contract transition for this impact analysis is unavailable.";

type QueueTransaction = Prisma.TransactionClient;
type OwnedRun = {
  id: string;
  monitorId: string;
  status: string;
  outcome: string | null;
  contractVersion: number;
  contractUrl: string;
  repositoryUrl: string;
  previousRevisionId: string | null;
  newRevisionId: string | null;
  previousSnapshotId: string | null;
  newSnapshotId: string | null;
  findings: unknown;
  monitor: {
    id: string;
    status: string;
    contractVersion: number;
    contractUrl: string;
    repositoryUrl: string;
    workspace: { id: string; ownerId: string };
  };
};

export class ImpactAnalysisError extends Error {
  constructor(readonly status: 403 | 404 | 409 | 429 | 503, message: string, readonly code?: string) {
    super(message);
    this.name = "ImpactAnalysisError";
  }
}

function isAnalysisCapabilityDenial(error: unknown): error is ImpactAnalysisError {
  return error instanceof ImpactAnalysisError &&
    ["WORKSPACE_FORBIDDEN", "CAPABILITY_DISABLED", "WORKSPACE_STATE_UNKNOWN"].includes(error.code ?? "");
}

function validIdempotencyKey(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function evidenceOf(value: unknown): ImpactEvidence[] {
  return Array.isArray(value) ? value.slice(0, MAX_EVIDENCE) as ImpactEvidence[] : [];
}

function coverageOf(value: unknown): ImpactCoverage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const coverage = value as Partial<ImpactCoverage>;
  if (!(["SUPPORTED", "PARTIAL", "UNSUPPORTED"] as unknown[]).includes(coverage.source) ||
    !Number.isSafeInteger(coverage.filesDiscovered) || !Number.isSafeInteger(coverage.filesAnalyzed) ||
    !Number.isSafeInteger(coverage.filesSkipped) || !Array.isArray(coverage.reasons)) return null;
  return {
    source: coverage.source as ImpactCoverage["source"],
    filesDiscovered: coverage.filesDiscovered as number,
    filesAnalyzed: coverage.filesAnalyzed as number,
    filesSkipped: coverage.filesSkipped as number,
    reasons: coverage.reasons.filter((reason): reason is string => typeof reason === "string").slice(0, 12),
  };
}

export function summarizeImpactAnalysis(row: Pick<ImpactAnalysis, "id" | "status" | "commitSha" | "queuedAt" | "startedAt" | "completedAt" | "coverage" | "evidence" | "error">): ImpactAnalysisSummary {
  const evidence = evidenceOf(row.evidence);
  const coverage = coverageOf(row.coverage);
  return {
    id: row.id,
    status: row.status,
    commitSha: row.commitSha || null,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    coverage,
    counts: {
      confirmed: evidence.filter((item) => item.classification === "CONFIRMED").length,
      candidates: evidence.filter((item) => item.classification === "CANDIDATE").length,
      unsupported: evidence.filter((item) => item.classification === "UNSUPPORTED").length,
    },
    error: row.error,
  };
}

function detailOf(row: ImpactAnalysis): ImpactAnalysisDetail {
  return { ...summarizeImpactAnalysis(row), evidence: evidenceOf(row.evidence) };
}

function findingsOf(value: unknown): CheckFinding[] {
  if (!Array.isArray(value)) return [];
  return value.filter((finding): finding is CheckFinding => Boolean(finding) && typeof finding === "object" &&
    (finding as CheckFinding).severity === "BREAKING");
}

async function loadOwnedCheckRun(monitorId: string, runId: string): Promise<{ run: OwnedRun; workspace: { id: string; ownerId: string } }> {
  const { requireWorkspace } = await import("@/lib/workspace");
  const workspace = await requireWorkspace();
  const run = await db.checkRun.findFirst({
    where: { id: runId, monitorId, monitor: { workspaceId: workspace.id } },
    include: { monitor: { include: { workspace: { select: { id: true, ownerId: true } } } } },
  });
  if (!run) throw new ImpactAnalysisError(404, "Check run not found.");
  return {
    run: { ...run, repositoryUrl: run.monitor.repositoryUrl } as unknown as OwnedRun,
    workspace: { id: workspace.id, ownerId: workspace.ownerId },
  };
}

function assertAnalyzable(run: OwnedRun) {
  if (run.status !== "SUCCESS" || run.outcome !== "CHANGES_FOUND" || !run.previousSnapshotId || !run.newSnapshotId ||
    !run.previousRevisionId || !run.newRevisionId || findingsOf(run.findings).length === 0) {
    throw new ImpactAnalysisError(409, "Impact analysis is available for successful checks with breaking changes.");
  }
}

async function assertCurrent(tx: QueueTransaction, runId: string, monitorId: string, workspaceId: string, expected: OwnedRun) {
  const run = await tx.checkRun.findFirst({
    where: { id: runId, monitorId, monitor: { workspaceId } },
    include: { monitor: { select: { id: true, status: true, contractVersion: true, contractUrl: true, repositoryUrl: true } } },
  });
  if (!run) throw new ImpactAnalysisError(404, "Check run not found.");
  if (run.status !== "SUCCESS" || run.outcome !== "CHANGES_FOUND" || run.contractVersion !== expected.contractVersion ||
    run.contractUrl !== expected.contractUrl || run.monitor.repositoryUrl !== expected.repositoryUrl ||
    run.previousSnapshotId !== expected.previousSnapshotId || run.newSnapshotId !== expected.newSnapshotId ||
    run.previousRevisionId !== expected.previousRevisionId || run.newRevisionId !== expected.newRevisionId ||
    run.monitor.status !== "READY" || run.monitor.contractVersion !== expected.contractVersion ||
    run.monitor.contractUrl !== expected.contractUrl || run.monitor.repositoryUrl !== expected.repositoryUrl) {
    throw new ImpactAnalysisError(409, STALE_MESSAGE);
  }
  return run;
}

function assertRetryMatchesCurrent(analysis: ImpactAnalysis, run: OwnedRun) {
  if (analysis.contractVersion !== run.contractVersion || analysis.contractUrl !== run.contractUrl ||
    analysis.repositoryUrl !== run.repositoryUrl || analysis.previousSnapshotId !== run.previousSnapshotId ||
    analysis.newSnapshotId !== run.newSnapshotId || analysis.previousRevisionId !== run.previousRevisionId ||
    analysis.newRevisionId !== run.newRevisionId) {
    throw new ImpactAnalysisError(409, STALE_MESSAGE);
  }
}

function usagePeriodStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function assertAnalysisCapability(workspaceId: string, actorUserId: string) {
  try {
    return await assertWorkspaceCapability({ workspaceId, actorUserId, capability: "analysis" });
  } catch (error) {
    if (error instanceof PolicyDeniedError) {
      const status = error.code === "WORKSPACE_FORBIDDEN" ? 404 : 403;
      throw new ImpactAnalysisError(status, "The current workspace cannot run impact analysis.", error.code);
    }
    throw error;
  }
}

async function enqueueAnalysis(tx: QueueTransaction, row: ImpactAnalysis) {
  await enqueueImpactAnalysisInTransaction(tx, row.id);
}

export async function requestImpactAnalysis(monitorId: string, runId: string, idempotencyKey: string): Promise<ImpactAnalysisSummary> {
  if (!validIdempotencyKey(idempotencyKey)) {
    throw new ImpactAnalysisError(409, "Send a valid UUID Idempotency-Key for this analysis.");
  }
  const { run, workspace } = await loadOwnedCheckRun(monitorId, runId);
  assertAnalyzable(run);
  const entitlement = await assertAnalysisCapability(workspace.id, workspace.ownerId);
  const existing = await db.impactAnalysis.findUnique({ where: { checkRunId: runId } });
  if (existing) {
    const duplicate = await db.impactAnalysisRequest.findUnique({ where: { analysisId_idempotencyKey: { analysisId: existing.id, idempotencyKey } } });
    if (duplicate) return summarizeImpactAnalysis(existing);
    if (existing.status === "FAILURE") {
      assertRetryMatchesCurrent(existing, run);
      await getMonitorCheckBoss();
    }
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspace.id} FOR UPDATE`;
      await assertCurrent(tx, runId, monitorId, workspace.id, run);
      await assertAnalysisCapability(workspace.id, workspace.ownerId);
      const current = await tx.impactAnalysis.findUnique({ where: { checkRunId: runId } });
      if (!current) throw new ImpactAnalysisError(409, "Impact analysis changed while this request was being processed.");
      const repeated = await tx.impactAnalysisRequest.findUnique({ where: { analysisId_idempotencyKey: { analysisId: current.id, idempotencyKey } } });
      if (repeated) return summarizeImpactAnalysis(current);
      await tx.impactAnalysisRequest.create({ data: { analysisId: current.id, idempotencyKey } });
      if (current.status !== "FAILURE") return summarizeImpactAnalysis(current);
      assertRetryMatchesCurrent(current, run);
      const retried = await tx.impactAnalysis.update({
        where: { id: current.id },
        data: { status: "QUEUED", attempts: 0, error: null, queuedAt: new Date(), startedAt: null, completedAt: null, claimToken: null, leaseExpiresAt: null },
      });
      await enqueueAnalysis(tx, retried);
      return summarizeImpactAnalysis(retried);
    });
  }

  assertAnalyzable(run);
  const periodStart = usagePeriodStart(new Date());
  const currentUsage = await db.impactAnalysis.count({ where: { workspaceId: workspace.id, createdAt: { gte: periodStart } } });
  if (currentUsage >= entitlement.limits.analysesPerPeriod) {
    throw new ImpactAnalysisError(429, "The workspace has reached its analysis limit for this month.", "ANALYSIS_LIMIT_REACHED");
  }
  let commitSha: string | null = null;
  let unsupportedReason: string | null = null;
  try {
    ({ commitSha } = await resolveRepositoryRevision(run.repositoryUrl));
  } catch (error) {
    if (error instanceof ImpactSourceError && ["UNSUPPORTED_SOURCE", "INVALID_SOURCE"].includes(error.code)) {
      unsupportedReason = "Impact analysis currently supports public GitHub repositories only.";
    } else {
      throw new ImpactAnalysisError(503, "The repository revision could not be pinned. Retry the analysis.", "REPOSITORY_UNAVAILABLE");
    }
  }

  if (!unsupportedReason) await getMonitorCheckBoss();

  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspace.id} FOR UPDATE`;
      await assertCurrent(tx, runId, monitorId, workspace.id, run);
      const currentEntitlement = await assertAnalysisCapability(workspace.id, workspace.ownerId);
      const current = await tx.impactAnalysis.findUnique({ where: { checkRunId: runId } });
      if (current) {
        const repeated = await tx.impactAnalysisRequest.findUnique({ where: { analysisId_idempotencyKey: { analysisId: current.id, idempotencyKey } } });
        if (!repeated) await tx.impactAnalysisRequest.create({ data: { analysisId: current.id, idempotencyKey } });
        return summarizeImpactAnalysis(current);
      }
      const now = new Date();
      const count = await tx.impactAnalysis.count({ where: { workspaceId: workspace.id, createdAt: { gte: usagePeriodStart(now) } } });
      if (count >= currentEntitlement.limits.analysesPerPeriod) {
        throw new ImpactAnalysisError(429, "The workspace has reached its analysis limit for this month.", "ANALYSIS_LIMIT_REACHED");
      }
      const row = await tx.impactAnalysis.create({
        data: {
          workspaceId: workspace.id,
          checkRunId: runId,
          analyzerVersion: IMPACT_ANALYZER_VERSION,
          contractVersion: run.contractVersion,
          contractUrl: run.contractUrl,
          repositoryUrl: run.repositoryUrl,
          previousSnapshotId: run.previousSnapshotId!,
          newSnapshotId: run.newSnapshotId!,
          previousRevisionId: run.previousRevisionId!,
          newRevisionId: run.newRevisionId!,
          commitSha,
          ...(unsupportedReason ? {
            status: "SUCCESS",
            coverage: { source: "UNSUPPORTED", filesDiscovered: 0, filesAnalyzed: 0, filesSkipped: 0, reasons: [unsupportedReason] } as Prisma.InputJsonValue,
            error: null,
            completedAt: now,
          } : {}),
        },
      });
      await tx.impactAnalysisRequest.create({ data: { analysisId: row.id, idempotencyKey } });
      if (!unsupportedReason) await enqueueAnalysis(tx, row);
      return summarizeImpactAnalysis(row);
    });
  } catch (error) {
    if (error instanceof ImpactAnalysisError || error instanceof PolicyDeniedError) throw error;
    const duplicate = await db.impactAnalysis.findUnique({ where: { checkRunId: runId } });
    if (duplicate) return summarizeImpactAnalysis(duplicate);
    throw new ImpactAnalysisError(503, "Impact analysis could not be queued. Retry the request.");
  }
}

export async function getImpactAnalysis(monitorId: string, runId: string): Promise<ImpactAnalysisDetail | null> {
  const { requireWorkspace } = await import("@/lib/workspace");
  const workspace = await requireWorkspace();
  const run = await db.checkRun.findFirst({
    where: { id: runId, monitorId, monitor: { workspaceId: workspace.id } },
    include: { impactAnalysis: true },
  });
  if (!run) throw new ImpactAnalysisError(404, "Check run not found.");
  await resolveWorkspaceEntitlement({ workspaceId: workspace.id, actorUserId: workspace.ownerId });
  return run.impactAnalysis ? detailOf(run.impactAnalysis) : null;
}

async function claimAnalysis(analysisId: string) {
  const now = new Date();
  const token = randomUUID();
  return db.$transaction(async (tx) => {
    const claimed = await tx.impactAnalysis.updateMany({
      where: { id: analysisId, attempts: { lt: MAX_ATTEMPTS }, OR: [{ status: "QUEUED" }, { status: "RUNNING", leaseExpiresAt: { lte: now } }] },
      data: { status: "RUNNING", claimToken: token, leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS), startedAt: now, attempts: { increment: 1 }, error: null },
    });
    if (!claimed.count) return null;
    const row = await tx.impactAnalysis.findUnique({
      where: { id: analysisId },
      include: { checkRun: { include: { monitor: { include: { workspace: { select: { id: true, ownerId: true } } } } } } },
    });
    return row ? { row, token } : null;
  });
}

async function markTerminalFailure(analysisId: string, token: string, message: string) {
  await db.$transaction(async (tx) => {
    const row = await tx.impactAnalysis.findFirst({ where: { id: analysisId, claimToken: token } });
    if (!row) return;
    await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${row.workspaceId} FOR UPDATE`;
    await tx.impactAnalysis.updateMany({
      where: { id: analysisId, claimToken: token, status: "RUNNING" },
      data: { status: "FAILURE", error: message, completedAt: new Date(), claimToken: null, leaseExpiresAt: null },
    });
  });
}

async function finishSuccess(analysisId: string, token: string, evidence: ImpactEvidence[], coverage: ImpactCoverage) {
  await db.$transaction(async (tx) => {
    const identity = await tx.impactAnalysis.findUnique({
      where: { id: analysisId },
      select: { workspaceId: true, checkRun: { select: { monitorId: true } } },
    });
    if (!identity) return;
    await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${identity.workspaceId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Monitor" WHERE "id" = ${identity.checkRun.monitorId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "CheckRun" WHERE "id" = (SELECT "checkRunId" FROM "ImpactAnalysis" WHERE "id" = ${analysisId}) FOR UPDATE`;
    const now = new Date();
    const row = await tx.impactAnalysis.findFirst({
      where: { id: analysisId, claimToken: token, status: "RUNNING", leaseExpiresAt: { gt: now } },
      include: { checkRun: { include: { monitor: true } } },
    });
    if (!row) return;
    try {
      const workspace = await tx.workspace.findUnique({ where: { id: row.workspaceId }, select: { ownerId: true } });
      if (!workspace) throw new PolicyDeniedError("WORKSPACE_FORBIDDEN");
      await assertAnalysisCapability(row.workspaceId, workspace.ownerId);
    } catch (error) {
      if (!isAnalysisCapabilityDenial(error)) throw error;
      await tx.impactAnalysis.updateMany({ where: { id: analysisId, claimToken: token }, data: { status: "FAILURE", error: POLICY_MESSAGE, completedAt: new Date(), claimToken: null, leaseExpiresAt: null } });
      return;
    }
    const monitor = row.checkRun.monitor;
    if (monitor.status === "WITHDRAWN") {
      await tx.impactAnalysis.updateMany({ where: { id: analysisId, claimToken: token }, data: { status: "FAILURE", error: WITHDRAWN_MESSAGE, completedAt: new Date(), claimToken: null, leaseExpiresAt: null } });
      return;
    }
    const checkRun = row.checkRun;
    if (monitor.status !== "READY" || monitor.contractVersion !== row.contractVersion || monitor.contractUrl !== row.contractUrl ||
      monitor.repositoryUrl !== row.repositoryUrl || checkRun.status !== "SUCCESS" || checkRun.outcome !== "CHANGES_FOUND" ||
      checkRun.contractVersion !== row.contractVersion || checkRun.contractUrl !== row.contractUrl ||
      checkRun.previousSnapshotId !== row.previousSnapshotId || checkRun.newSnapshotId !== row.newSnapshotId ||
      checkRun.previousRevisionId !== row.previousRevisionId || checkRun.newRevisionId !== row.newRevisionId) {
      await tx.impactAnalysis.updateMany({ where: { id: analysisId, claimToken: token }, data: { status: "FAILURE", error: STALE_MESSAGE, completedAt: new Date(), claimToken: null, leaseExpiresAt: null } });
      return;
    }
    const snapshots = await tx.contractSnapshot.findMany({
      where: { monitorId: monitor.id, contractVersion: row.contractVersion, OR: [
        { id: row.previousSnapshotId, revisionId: row.previousRevisionId },
        { id: row.newSnapshotId, revisionId: row.newRevisionId },
      ] },
      select: { id: true },
    });
    if (snapshots.length !== 2) {
      await tx.impactAnalysis.updateMany({ where: { id: analysisId, claimToken: token }, data: { status: "FAILURE", error: SNAPSHOT_MESSAGE, completedAt: new Date(), claimToken: null, leaseExpiresAt: null } });
      return;
    }
    await tx.impactAnalysis.updateMany({
      where: { id: analysisId, claimToken: token, status: "RUNNING", leaseExpiresAt: { gt: new Date() } },
      data: { status: "SUCCESS", analyzerVersion: IMPACT_ANALYZER_VERSION, evidence: evidence.slice(0, MAX_EVIDENCE) as Prisma.InputJsonValue, coverage: coverage as Prisma.InputJsonValue,
        error: null, completedAt: new Date(), claimToken: null, leaseExpiresAt: null },
    });
  });
}

async function handleRetryableFailure(analysisId: string, token: string) {
  const row = await db.impactAnalysis.findFirst({ where: { id: analysisId, claimToken: token }, select: { attempts: true } });
  const terminal = !row || row.attempts >= MAX_ATTEMPTS;
  await db.impactAnalysis.updateMany({
    where: { id: analysisId, claimToken: token, status: "RUNNING" },
    data: terminal
      ? { status: "FAILURE", error: FAILURE_MESSAGE, completedAt: new Date(), claimToken: null, leaseExpiresAt: null }
      : { status: "QUEUED", error: FAILURE_MESSAGE, claimToken: null, leaseExpiresAt: null },
  });
  return terminal;
}

export async function processImpactAnalysis(analysisId: string): Promise<void> {
  const claimed = await claimAnalysis(analysisId);
  if (!claimed) return;
  const { row, token } = claimed;
  const run = row.checkRun;
  const monitor = run.monitor;
  try {
    if (monitor.status === "WITHDRAWN") {
      await markTerminalFailure(analysisId, token, WITHDRAWN_MESSAGE);
      return;
    }
    if (monitor.status !== "READY" || monitor.contractVersion !== row.contractVersion || monitor.contractUrl !== row.contractUrl ||
      monitor.repositoryUrl !== row.repositoryUrl || run.status !== "SUCCESS" || run.outcome !== "CHANGES_FOUND" ||
      run.contractVersion !== row.contractVersion || run.previousSnapshotId !== row.previousSnapshotId || run.newSnapshotId !== row.newSnapshotId ||
      run.previousRevisionId !== row.previousRevisionId || run.newRevisionId !== row.newRevisionId) {
      await markTerminalFailure(analysisId, token, STALE_MESSAGE);
      return;
    }
    try { await assertAnalysisCapability(row.workspaceId, monitor.workspace.ownerId); }
    catch (error) {
      if (!isAnalysisCapabilityDenial(error)) throw error;
      await markTerminalFailure(analysisId, token, POLICY_MESSAGE);
      return;
    }

    const [previousSnapshot, nextSnapshot] = await Promise.all([
      db.contractSnapshot.findFirst({ where: { id: row.previousSnapshotId, monitorId: monitor.id, contractVersion: row.contractVersion, revisionId: row.previousRevisionId } }),
      db.contractSnapshot.findFirst({ where: { id: row.newSnapshotId, monitorId: monitor.id, contractVersion: row.contractVersion, revisionId: row.newRevisionId } }),
    ]);
    if (!previousSnapshot || !nextSnapshot) {
      await markTerminalFailure(analysisId, token, SNAPSHOT_MESSAGE);
      return;
    }

    let files: Array<{ path: string; content: string }> = [];
    let coverage: ImpactCoverage;
    try {
      ({ files, coverage } = await readRepositoryFiles({ repositoryUrl: row.repositoryUrl, commitSha: row.commitSha ?? "" }));
    } catch (error) {
      if (error instanceof ImpactSourceError && ["UNSUPPORTED_SOURCE", "INVALID_SOURCE"].includes(error.code)) {
        coverage = { source: "UNSUPPORTED", filesDiscovered: 0, filesAnalyzed: 0, filesSkipped: 0, reasons: ["Impact analysis currently supports public GitHub repositories only."] };
      } else {
        throw error;
      }
    }
    const analysis = await analyzeContractImpact({
      previousContract: previousSnapshot.document,
      nextContract: nextSnapshot.document,
      repositoryUrl: row.repositoryUrl,
      contractUrl: row.contractUrl,
      commitSha: row.commitSha ?? "",
      findings: findingsOf(run.findings),
      files,
      coverage,
    });
    await finishSuccess(analysisId, token, analysis.evidence, analysis.coverage);
  } catch {
    const terminal = await handleRetryableFailure(analysisId, token);
    if (!terminal) throw new Error("Impact analysis failed and remains queued for bounded retry.");
  }
}

export async function dispatchDueImpactAnalyses(): Promise<void> {
  const boss = await getMonitorCheckBoss();
  const stale = await db.impactAnalysis.findMany({
    where: { OR: [{ status: "QUEUED" }, { status: "RUNNING", leaseExpiresAt: { lte: new Date() } }] },
    select: { id: true, status: true, leaseExpiresAt: true, attempts: true },
    orderBy: { queuedAt: "asc" },
    take: 100,
  });
  for (const item of stale) {
    await db.$transaction(async (tx) => {
      if (item.status === "RUNNING") {
        if (item.attempts >= MAX_ATTEMPTS) {
          await tx.impactAnalysis.updateMany({
            where: { id: item.id, status: "RUNNING", leaseExpiresAt: { lte: new Date() } },
            data: { status: "FAILURE", error: FAILURE_MESSAGE, completedAt: new Date(), claimToken: null, leaseExpiresAt: null },
          });
          return;
        }
        const reset = await tx.impactAnalysis.updateMany({
          where: { id: item.id, status: "RUNNING", leaseExpiresAt: { lte: new Date() } },
          data: { status: "QUEUED", claimToken: null, leaseExpiresAt: null, startedAt: null, error: FAILURE_MESSAGE },
        });
        if (!reset.count) return;
      } else {
        if (item.attempts >= MAX_ATTEMPTS) {
          await tx.impactAnalysis.updateMany({
            where: { id: item.id, status: "QUEUED" },
            data: { status: "FAILURE", error: FAILURE_MESSAGE, completedAt: new Date(), claimToken: null, leaseExpiresAt: null },
          });
          return;
        }
        const current = await tx.impactAnalysis.findFirst({ where: { id: item.id, status: "QUEUED", attempts: { lt: MAX_ATTEMPTS } }, select: { id: true } });
        if (!current) return;
      }
      await boss.send(MONITOR_IMPACT_ANALYSIS_QUEUE, { analysisId: item.id }, {
        id: randomUUID(), singletonKey: item.id, retryLimit: 3, retryDelay: 10, retryBackoff: true,
        retryDelayMax: 300, db: fromPrisma(tx),
      });
    }).catch(() => undefined);
  }
}
