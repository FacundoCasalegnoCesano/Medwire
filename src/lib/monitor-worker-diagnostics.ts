export type WorkerOperation = "worker-start" | "queue-connect" | "queue-event" | "worker-stop" | "database-close";
export type WorkerFailure = "DATABASE_URL_MISSING" | "DATABASE_CONNECTION_REFUSED" | "QUEUE_FAILURE";

export class MissingMonitorDatabaseUrlError extends Error {
  readonly code = "DATABASE_URL_MISSING";

  constructor() {
    super("DATABASE_URL is not configured.");
  }
}

function errorCode(error: unknown, seen = new Set<object>()): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if (seen.has(error)) return undefined;
  seen.add(error);
  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code === "ECONNREFUSED") return candidate.code;
  return errorCode(candidate.cause, seen);
}

export function safeWorkerDiagnostic(operation: WorkerOperation, error: unknown): string {
  const failure: WorkerFailure = error instanceof MissingMonitorDatabaseUrlError
    ? "DATABASE_URL_MISSING"
    : errorCode(error) === "ECONNREFUSED"
      ? "DATABASE_CONNECTION_REFUSED"
      : "QUEUE_FAILURE";
  return `Monitoring ${operation} failed [${failure}].`;
}
