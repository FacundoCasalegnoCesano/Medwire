import "server-only";
import { randomUUID } from "node:crypto";
import type { Monitor } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getMonitorSourceInputError, validateMonitorSources } from "@/lib/monitor-sources";
import type { MonitorView } from "@/lib/monitor-types";
import { requireWorkspace } from "@/lib/workspace";
import { assertWorkspaceCapability, resolveWorkspaceEntitlement } from "@/lib/beta-policy";
import { summarizeCheckRun, summarizeImpactAnalysis, type MonitorCheckState } from "@/lib/monitor-check-types";
import { MonitorCapacityError, MonitorConflictError, MonitorNotFoundError } from "@/lib/monitor-errors";

export { MonitorCapacityError, MonitorConflictError, MonitorNotFoundError } from "@/lib/monitor-errors";

export const monitorLimits = { name: 80, sourceUrl: 2048 } as const;

export type MonitorInput = {
  name: string;
  contractUrl: string;
  repositoryUrl: string;
};

export class MonitorInputError extends Error {
  constructor(readonly fields: Partial<Record<keyof MonitorInput, string>>) {
    super("Check the highlighted fields.");
  }
}

function validateInput(input: MonitorInput): MonitorInput {
  const rawName = typeof input.name === "string" ? input.name : "";
  const rawContractUrl = typeof input.contractUrl === "string" ? input.contractUrl : "";
  const rawRepositoryUrl = typeof input.repositoryUrl === "string" ? input.repositoryUrl : "";
  const name = rawName.trim();
  const contractUrl = rawContractUrl.trim();
  const repositoryUrl = rawRepositoryUrl.trim();
  const fields: MonitorInputError["fields"] = {};
  if (!name) fields.name = "Enter a monitor name.";
  else if (rawName.length > monitorLimits.name) fields.name = `Use ${monitorLimits.name} characters or fewer.`;
  if (rawContractUrl.length > monitorLimits.sourceUrl) fields.contractUrl = `Use ${monitorLimits.sourceUrl} characters or fewer.`;
  if (rawRepositoryUrl.length > monitorLimits.sourceUrl) fields.repositoryUrl = `Use ${monitorLimits.sourceUrl} characters or fewer.`;
  const contractInputError = getMonitorSourceInputError(contractUrl, "contract");
  const repositoryInputError = getMonitorSourceInputError(repositoryUrl, "repository");
  if (contractInputError) fields.contractUrl = contractInputError;
  if (repositoryInputError) fields.repositoryUrl = repositoryInputError;
  if (Object.keys(fields).length) throw new MonitorInputError(fields);
  return { name, contractUrl, repositoryUrl };
}

function sourceError(error: string | null, fallback: string) {
  if (!error) return null;
  const message = error.replace(/[\r\n\u0000-\u001f]/g, " ").trim();
  if (!message || message.length > 180 || /[{}\[\]<>"']/.test(message)) return fallback;
  return message;
}

async function runValidation(input: MonitorInput) {
  try {
    const result = await validateMonitorSources({ contractUrl: input.contractUrl, repositoryUrl: input.repositoryUrl });
    return {
      contractError: result.contract.valid ? null : sourceError(result.contract.error, "Could not validate the OpenAPI source."),
      repositoryError: result.repository.valid ? null : sourceError(result.repository.error, "Could not validate the Git repository."),
      ready: result.contract.valid && result.repository.valid,
    };
  } catch {
    return {
      contractError: "OpenAPI source validation could not be completed. Try again.",
      repositoryError: "Repository validation could not be completed. Try again.",
      ready: false,
    };
  }
}

function view(monitor: Monitor, checkState: MonitorCheckState): MonitorView {
  const { id, name, contractUrl, repositoryUrl, status, contractError, repositoryError, createdAt, updatedAt } = monitor;
  return { id, name, contractUrl, repositoryUrl, status, contractError, repositoryError, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString(), ...checkState };
}

async function finishValidation(workspaceId: string, monitorId: string, attemptId: string, input: MonitorInput) {
  const validation = await runValidation(input);
  await db.monitor.updateMany({
    where: { id: monitorId, workspaceId, validationAttemptId: attemptId },
    data: {
      status: validation.ready ? "READY" : "DRAFT",
      contractError: validation.contractError,
      repositoryError: validation.repositoryError,
      validationAttemptId: null,
      nextCheckAt: validation.ready ? new Date() : null,
    },
  });

  const current = await db.monitor.findFirst({ where: { id: monitorId, workspaceId } });
  if (!current) throw new MonitorNotFoundError();
  return current;
}

async function monitorView(monitor: Monitor, workspace: { id: string; ownerId: string }, resolvedEntitlement?: Awaited<ReturnType<typeof resolveWorkspaceEntitlement>>): Promise<MonitorView> {
  const [activeRun, latestRun, baseline, lastManual] = await Promise.all([
    db.checkRun.findFirst({
      where: { monitorId: monitor.id, contractVersion: monitor.contractVersion, status: { in: ["QUEUED", "RUNNING"] } },
      orderBy: { queuedAt: "desc" },
      select: { status: true },
    }),
    db.checkRun.findFirst({
      where: { monitorId: monitor.id, contractVersion: monitor.contractVersion },
      orderBy: [{ queuedAt: "desc" }, { id: "desc" }],
      include: { impactAnalysis: true },
    }),
    monitor.currentRevisionId
      ? db.contractSnapshot.findUnique({ where: { id: monitor.currentRevisionId }, select: { revisionId: true, createdAt: true, contractVersion: true } })
      : Promise.resolve(null),
    db.checkRun.findFirst({
      where: { monitorId: monitor.id, contractVersion: monitor.contractVersion, trigger: "MANUAL" },
      orderBy: { queuedAt: "desc" },
      select: { queuedAt: true },
    }),
  ]);
  const entitlement = resolvedEntitlement ?? await resolveWorkspaceEntitlement({ workspaceId: workspace.id, actorUserId: workspace.ownerId });
  const policyAllowsCheck = entitlement.effectiveState !== "unknown" && entitlement.capabilities.runCheck;
  const cooldownMs = entitlement.manualCheckCooldownSeconds * 1_000;
  const availableAt = lastManual ? new Date(lastManual.queuedAt.getTime() + cooldownMs) : null;
  const cooldownActive = availableAt !== null && availableAt.getTime() > Date.now();
  let reason: string | null = null;
  if (monitor.status === "WITHDRAWN") reason = "Reactivate and validate both sources before running another check.";
  else if (monitor.status !== "READY") reason = "Validate both sources before running a check.";
  else if (!policyAllowsCheck) reason = "The current workspace plan does not allow checks.";
  else if (activeRun) reason = "A check is already queued or running.";
  else if (cooldownActive) reason = "Wait until the manual check cooldown ends.";
  const pauseReason = monitor.status === "WITHDRAWN" ? "WITHDRAWN" : policyAllowsCheck ? null : "POLICY_DENIED";
  const monitoringStatus = pauseReason
    ? "PAUSED"
    : activeRun?.status === "QUEUED" || activeRun?.status === "RUNNING"
      ? activeRun.status
      : "READY";
  const latestSummary = latestRun ? summarizeCheckRun({
    ...latestRun,
    impactAnalysis: latestRun.impactAnalysis ? summarizeImpactAnalysis(latestRun.impactAnalysis) : null,
  }) : null;
  const checkState = {
    monitoringStatus,
    pauseReason,
    manualCheck: {
      allowed: reason === null,
      reason,
      availableAt: cooldownActive ? availableAt!.toISOString() : null,
    },
    baseline: baseline && baseline.contractVersion === monitor.contractVersion
      ? { revisionId: baseline.revisionId, savedAt: baseline.createdAt.toISOString() }
      : null,
    lastRun: latestSummary,
    lastSuccessfulCheckAt: monitor.lastSuccessfulCheckAt?.toISOString() ?? null,
    nextCheckAt: monitor.status === "READY" && policyAllowsCheck ? monitor.nextCheckAt?.toISOString() ?? null : null,
  } satisfies MonitorCheckState;
  return view(monitor, checkState);
}

export async function listMonitors(): Promise<MonitorView[]> {
  const workspace = await requireWorkspace();
  const entitlement = await resolveWorkspaceEntitlement({ workspaceId: workspace.id, actorUserId: workspace.ownerId });
  const monitors = await db.monitor.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(monitors.map((monitor) => monitorView(monitor, workspace, entitlement)));
}

export async function getMonitor(monitorId: string): Promise<MonitorView> {
  const workspace = await requireWorkspace();
  const monitor = await db.monitor.findFirst({ where: { id: monitorId, workspaceId: workspace.id } });
  if (!monitor) throw new MonitorNotFoundError();
  return monitorView(monitor, workspace);
}

export async function createMonitor(rawInput: MonitorInput): Promise<MonitorView> {
  const workspace = await requireWorkspace();
  const entitlement = await assertWorkspaceCapability({ workspaceId: workspace.id, actorUserId: workspace.ownerId, capability: "manage-monitors" });
  const input = validateInput(rawInput);
  const attemptId = randomUUID();
  const created = await db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT \"id\" FROM \"Workspace\" WHERE \"id\" = $1 FOR UPDATE", workspace.id);
    const activeCount = await tx.monitor.count({ where: { workspaceId: workspace.id, status: { not: "WITHDRAWN" } } });
    if (activeCount >= entitlement.limits.activeMonitors) throw new MonitorCapacityError(entitlement.limits.activeMonitors);
    return tx.monitor.create({ data: { ...input, workspaceId: workspace.id, status: "DRAFT", validationAttemptId: attemptId } });
  });
  const monitor = await finishValidation(workspace.id, created.id, attemptId, input);
  return monitorView(monitor, workspace);
}

export async function updateMonitor(monitorId: string, rawInput: MonitorInput): Promise<MonitorView> {
  const workspace = await requireWorkspace();
  await assertWorkspaceCapability({ workspaceId: workspace.id, actorUserId: workspace.ownerId, capability: "manage-monitors" });
  const input = validateInput(rawInput);
  const attemptId = randomUUID();
  const previous = await db.monitor.findFirst({ where: { id: monitorId, workspaceId: workspace.id } });
  if (!previous) throw new MonitorNotFoundError();
  if (previous.status === "WITHDRAWN") throw new MonitorConflictError();
  const contractChanged = previous.contractUrl !== input.contractUrl;
  const updated = await db.monitor.updateMany({
    where: { id: monitorId, workspaceId: workspace.id, status: { not: "WITHDRAWN" } },
    data: {
      ...input,
      status: "DRAFT",
      contractError: null,
      repositoryError: null,
      validationAttemptId: attemptId,
      nextCheckAt: null,
      ...(contractChanged ? { contractVersion: { increment: 1 }, currentRevisionId: null, lastSuccessfulCheckAt: null } : {}),
    },
  });
  if (updated.count === 0) {
    const exists = await db.monitor.findFirst({ where: { id: monitorId, workspaceId: workspace.id }, select: { id: true } });
    if (!exists) throw new MonitorNotFoundError();
    throw new MonitorConflictError();
  }
  const monitor = await finishValidation(workspace.id, monitorId, attemptId, input);
  return monitorView(monitor, workspace);
}

export async function withdrawMonitor(monitorId: string): Promise<MonitorView> {
  const workspace = await requireWorkspace();
  const attemptId = randomUUID();
  await db.monitor.updateMany({
    where: { id: monitorId, workspaceId: workspace.id, status: { not: "WITHDRAWN" } },
    data: { status: "WITHDRAWN", validationAttemptId: attemptId, nextCheckAt: null },
  });
  const current = await db.monitor.findFirst({ where: { id: monitorId, workspaceId: workspace.id } });
  if (!current) throw new MonitorNotFoundError();
  return monitorView(current, workspace);
}

export async function reactivateMonitor(monitorId: string): Promise<MonitorView> {
  const workspace = await requireWorkspace();
  const entitlement = await assertWorkspaceCapability({ workspaceId: workspace.id, actorUserId: workspace.ownerId, capability: "manage-monitors" });
  const attemptId = randomUUID();
  const changed = await db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT \"id\" FROM \"Workspace\" WHERE \"id\" = $1 FOR UPDATE", workspace.id);
    const target = await tx.monitor.findFirst({ where: { id: monitorId, workspaceId: workspace.id }, select: { status: true } });
    if (!target) throw new MonitorNotFoundError();
    if (target.status !== "WITHDRAWN") throw new MonitorConflictError();
    const activeCount = await tx.monitor.count({ where: { workspaceId: workspace.id, status: { not: "WITHDRAWN" } } });
    if (activeCount >= entitlement.limits.activeMonitors) throw new MonitorCapacityError(entitlement.limits.activeMonitors);
    return tx.monitor.updateMany({
      where: { id: monitorId, workspaceId: workspace.id, status: "WITHDRAWN" },
      data: { status: "DRAFT", contractError: null, repositoryError: null, validationAttemptId: attemptId, nextCheckAt: null },
    });
  });
  if (changed.count === 0) {
    const exists = await db.monitor.findFirst({ where: { id: monitorId, workspaceId: workspace.id }, select: { id: true } });
    if (!exists) throw new MonitorNotFoundError();
    throw new MonitorConflictError();
  }
  const pending = await db.monitor.findFirst({
    where: { id: monitorId, workspaceId: workspace.id, validationAttemptId: attemptId },
    select: { name: true, contractUrl: true, repositoryUrl: true },
  });
  if (!pending) throw new MonitorNotFoundError();
  const monitor = await finishValidation(workspace.id, monitorId, attemptId, pending);
  return monitorView(monitor, workspace);
}
