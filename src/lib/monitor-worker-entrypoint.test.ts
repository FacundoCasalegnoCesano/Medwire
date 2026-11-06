import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("monitor worker entrypoint", () => {
  it("reports missing DATABASE_URL safely before loading the database client", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: "" };
    delete env.MENDWIRE_QUERY_DIAGNOSTICS;
    const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/monitor-worker.ts"], {
      cwd: resolve(__dirname, "../.."), env, encoding: "utf8", timeout: 15_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("Monitoring worker-start failed [DATABASE_URL_MISSING].");
    expect(result.stderr).not.toMatch(/DATABASE_URL is not configured|stack|password|postgres:\/\//i);
  });
});
