import { describe, expect, it } from "vitest";
import { MissingMonitorDatabaseUrlError, safeWorkerDiagnostic } from "@/lib/monitor-worker-diagnostics";

describe("safe worker diagnostics", () => {
  it("distinguishes missing configuration, refused database connections, and queue failures", () => {
    expect(safeWorkerDiagnostic("worker-start", new MissingMonitorDatabaseUrlError()))
      .toBe("Monitoring worker-start failed [DATABASE_URL_MISSING].");
    expect(safeWorkerDiagnostic("queue-connect", Object.assign(new Error("refused"), { code: "ECONNREFUSED" })))
      .toBe("Monitoring queue-connect failed [DATABASE_CONNECTION_REFUSED].");
    expect(safeWorkerDiagnostic("queue-event", new Error("queue unavailable")))
      .toBe("Monitoring queue-event failed [QUEUE_FAILURE].");
  });

  it("never includes sensitive error messages, nested causes, or payload properties", () => {
    const error = Object.assign(new Error("postgres://user:password@db.example/app secret-payload"), {
      code: "EQUEUE",
      cause: Object.assign(new Error("password=private"), { detail: "source payload" }),
    });
    const diagnostic = safeWorkerDiagnostic("worker-start", error);

    expect(diagnostic).toBe("Monitoring worker-start failed [QUEUE_FAILURE].");
    for (const secret of ["password", "db.example", "secret-payload", "source payload", "postgres://"]) {
      expect(diagnostic).not.toContain(secret);
    }
  });
});
