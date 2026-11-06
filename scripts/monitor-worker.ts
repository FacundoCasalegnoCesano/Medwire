import { MissingMonitorDatabaseUrlError, safeWorkerDiagnostic } from "@/lib/monitor-worker-diagnostics";

let resolveShutdown: (() => void) | undefined;
const shutdownRequested = new Promise<void>((resolve) => {
  resolveShutdown = resolve;
});

process.once("SIGINT", () => resolveShutdown?.());
process.once("SIGTERM", () => resolveShutdown?.());

async function main() {
  let database: typeof import("@/lib/db").db | undefined;
  let stopWorker: typeof import("@/lib/monitor-queue").stopMonitorWorker | undefined;
  try {
    if (!process.env.DATABASE_URL) throw new MissingMonitorDatabaseUrlError();
    const [{ db }, checks, analyses, queue] = await Promise.all([
      import("@/lib/db"), import("@/lib/monitor-checks"), import("@/lib/impact-analysis"), import("@/lib/monitor-queue"),
    ]);
    database = db;
    stopWorker = queue.stopMonitorWorker;
    await queue.startMonitorWorker(checks.processMonitorCheckRun, checks.dispatchDueMonitorChecks, analyses.processImpactAnalysis, analyses.dispatchDueImpactAnalyses);
    console.log("Monitoring worker started.");
    await shutdownRequested;
  } catch (error) {
    console.error(safeWorkerDiagnostic("worker-start", error));
    process.exitCode = 1;
  } finally {
    try {
      await stopWorker?.();
    } catch (error) {
      console.error(safeWorkerDiagnostic("worker-stop", error));
      process.exitCode = 1;
    }
    try {
      await database?.$disconnect();
    } catch (error) {
      console.error(safeWorkerDiagnostic("database-close", error));
      process.exitCode = 1;
    }
  }
}

void main();
