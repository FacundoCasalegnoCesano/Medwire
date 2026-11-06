import { db } from "@/lib/db";
import { dispatchDueMonitorChecks, processMonitorCheckRun } from "@/lib/monitor-checks";
import { dispatchDueImpactAnalyses, processImpactAnalysis } from "@/lib/impact-analysis";
import { startMonitorWorker, stopMonitorWorker } from "@/lib/monitor-queue";

let resolveShutdown: (() => void) | undefined;
const shutdownRequested = new Promise<void>((resolve) => {
  resolveShutdown = resolve;
});

process.once("SIGINT", () => resolveShutdown?.());
process.once("SIGTERM", () => resolveShutdown?.());

async function main() {
  try {
    await startMonitorWorker(processMonitorCheckRun, dispatchDueMonitorChecks, processImpactAnalysis, dispatchDueImpactAnalyses);
    console.log("Monitoring worker started.");
    await shutdownRequested;
  } catch {
    console.error("Monitoring worker could not start or continue. Check the local database and queue configuration.");
    process.exitCode = 1;
  } finally {
    try {
      await stopMonitorWorker();
    } catch {
      console.error("Monitoring queue did not stop cleanly.");
      process.exitCode = 1;
    }
    try {
      await db.$disconnect();
    } catch {
      console.error("The monitoring worker database client did not close cleanly.");
      process.exitCode = 1;
    }
  }
}

void main();
