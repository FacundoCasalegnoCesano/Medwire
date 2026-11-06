import { randomUUID } from "node:crypto";
import { fromPrisma, PgBoss } from "pg-boss";
import type { Prisma } from "@/generated/prisma/client";

export const MONITOR_CHECK_QUEUE = "monitor-check";
export const MONITOR_DISPATCH_QUEUE = "monitor-dispatch";
export const MONITOR_IMPACT_ANALYSIS_QUEUE = "monitor-impact-analysis";

export type MonitorCheckJob = { runId: string };
export type MonitorImpactAnalysisJob = { analysisId: string };
export type ProcessMonitorCheck = (runId: string) => Promise<void>;
export type DispatchMonitorChecks = () => Promise<void>;
export type ProcessImpactAnalysis = (analysisId: string) => Promise<void>;
export type DispatchImpactAnalyses = () => Promise<void>;

type MonitorQueueGlobal = typeof globalThis & {
  __mendwireMonitorBoss?: Promise<PgBoss>;
  __mendwireMonitorWorkerStarted?: boolean;
};

const globalForMonitorQueue = globalThis as MonitorQueueGlobal;

async function createMonitorCheckBoss() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  const boss = new PgBoss({
    connectionString,
    schema: "pgboss",
    application_name: "mendwire-monitoring",
    max: 4,
  });
  boss.on("error", () => console.error("The monitoring queue reported an error."));
  boss.on("warning", () => console.warn("The monitoring queue reported a warning."));
  await boss.start();
  await boss.createQueue(MONITOR_CHECK_QUEUE, {
    expireInSeconds: 600,
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    retryDelayMax: 300,
    retentionSeconds: 60 * 60 * 24 * 14,
    deleteAfterSeconds: 60 * 60 * 24 * 14,
  });
  await boss.createQueue(MONITOR_IMPACT_ANALYSIS_QUEUE, {
    expireInSeconds: 600,
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    retryDelayMax: 300,
    retentionSeconds: 60 * 60 * 24 * 14,
    deleteAfterSeconds: 60 * 60 * 24 * 14,
  });
  return boss;
}

export function getMonitorCheckBoss(): Promise<PgBoss> {
  if (!globalForMonitorQueue.__mendwireMonitorBoss) {
    globalForMonitorQueue.__mendwireMonitorBoss = createMonitorCheckBoss().catch((error: unknown) => {
      globalForMonitorQueue.__mendwireMonitorBoss = undefined;
      throw error;
    });
  }
  return globalForMonitorQueue.__mendwireMonitorBoss;
}

export async function enqueueImpactAnalysisInTransaction(tx: Prisma.TransactionClient, analysisId: string) {
  const boss = await getMonitorCheckBoss();
  await boss.send(MONITOR_IMPACT_ANALYSIS_QUEUE, { analysisId }, {
    id: randomUUID(),
    singletonKey: analysisId,
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    retryDelayMax: 300,
    db: fromPrisma(tx),
  });
}

export async function startMonitorWorker(
  processRun?: ProcessMonitorCheck,
  dispatchDue?: DispatchMonitorChecks,
  processImpact?: ProcessImpactAnalysis,
  dispatchImpacts?: DispatchImpactAnalyses,
) {
  if (globalForMonitorQueue.__mendwireMonitorWorkerStarted) return;
  const boss = await getMonitorCheckBoss();
  const processCheck = processRun ?? (async (runId: string) => {
    const checks = await import("@/lib/monitor-checks");
    await checks.processMonitorCheckRun(runId);
  });
  const dispatchChecks = dispatchDue ?? (async () => {
    const checks = await import("@/lib/monitor-checks");
    await checks.dispatchDueMonitorChecks();
  });
  const processImpactRun = processImpact ?? (async (analysisId: string) => {
    const analyses = await import("@/lib/impact-analysis");
    await analyses.processImpactAnalysis(analysisId);
  });
  const dispatchImpactRuns = dispatchImpacts ?? (async () => {
    const analyses = await import("@/lib/impact-analysis");
    await analyses.dispatchDueImpactAnalyses();
  });

  await boss.createQueue(MONITOR_DISPATCH_QUEUE, {
    expireInSeconds: 60,
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    retryDelayMax: 60,
    retentionSeconds: 60 * 60 * 24,
    deleteAfterSeconds: 60 * 60 * 24,
  });
  await boss.work<MonitorCheckJob>(MONITOR_CHECK_QUEUE, { batchSize: 1 }, async (jobs) => {
    const runId = jobs[0]?.data.runId;
    if (!runId) throw new Error("Monitor check job payload is missing its run identifier.");
    await processCheck(runId);
  });
  await boss.work<Record<string, never>>(MONITOR_DISPATCH_QUEUE, { batchSize: 1 }, async () => {
    await Promise.all([dispatchChecks(), dispatchImpactRuns()]);
  });
  await boss.work<MonitorImpactAnalysisJob>(MONITOR_IMPACT_ANALYSIS_QUEUE, { batchSize: 1 }, async (jobs) => {
    const analysisId = jobs[0]?.data.analysisId;
    if (!analysisId) throw new Error("Impact analysis job payload is missing its identifier.");
    await processImpactRun(analysisId);
  });
  await boss.schedule(MONITOR_DISPATCH_QUEUE, "* * * * *", {});
  globalForMonitorQueue.__mendwireMonitorWorkerStarted = true;
}

export async function stopMonitorWorker() {
  if (!globalForMonitorQueue.__mendwireMonitorBoss) return;
  const boss = await globalForMonitorQueue.__mendwireMonitorBoss;
  globalForMonitorQueue.__mendwireMonitorWorkerStarted = false;
  await boss.stop({ graceful: true, timeout: 30_000 });
  globalForMonitorQueue.__mendwireMonitorBoss = undefined;
}
