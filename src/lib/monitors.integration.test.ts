import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const context = vi.hoisted(() => ({ cookie: "" }));
const sourceValidation = vi.hoisted(() => ({
  validate: vi.fn(async ({ contractUrl }: { contractUrl: string }) => ({
    contract: contractUrl.includes("invalid")
      ? { valid: false, error: "OpenAPI document could not be read." }
      : { valid: true, error: null },
    repository: { valid: true, error: null },
  })),
  inputError: vi.fn((): string | null => null),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: context.cookie }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string): never => { throw new Error(`NEXT_REDIRECT:${path}`); } }));
vi.mock("@/lib/monitor-sources", () => ({
  validateMonitorSources: sourceValidation.validate,
  getMonitorSourceInputError: sourceValidation.inputError,
}));

const testDatabaseUrl = process.env.AUTH_TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("Set AUTH_TEST_DATABASE_URL to a dedicated local test database before running test:integration");
const testDatabase = new URL(testDatabaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(testDatabase.hostname) || !testDatabase.pathname.endsWith("_test")) {
  throw new Error("AUTH_TEST_DATABASE_URL must use a loopback host and a database name ending in _test");
}
process.env.DATABASE_URL = testDatabaseUrl;
process.env.BETTER_AUTH_URL = process.env.AUTH_TEST_BASE_URL ?? "http://127.0.0.1:3000";
process.env.BETTER_AUTH_SECRET = "test-only-secret-that-is-long-enough-for-better-auth";

const appUrl = process.env.BETTER_AUTH_URL!;
const emailA = `monitor-${randomUUID()}@example.test`;
const emailB = `monitor-${randomUUID()}@example.test`;
type MonitorRecord = { id: string; status: string; contractError: string | null; contractUrl: string };

describe("monitor lifecycle integration", () => {
  let db = undefined as unknown as typeof import("@/lib/db").db;
  let auth = undefined as unknown as typeof import("@/lib/auth").auth;
  let getMonitors: typeof import("@/app/api/monitors/route").GET;
  let postMonitor: typeof import("@/app/api/monitors/route").POST;
  let patchMonitor: typeof import("@/app/api/monitors/[id]/route").PATCH;
  const cookies: string[] = [];

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    ({ auth } = await import("@/lib/auth"));
    ({ GET: getMonitors, POST: postMonitor } = await import("@/app/api/monitors/route"));
    ({ PATCH: patchMonitor } = await import("@/app/api/monitors/[id]/route"));
    await db.$connect();
  });

  afterAll(async () => {
    if (!db?.$disconnect) return;
    await db.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
    await db.$disconnect();
  });

  async function authRequest(path: string, body?: unknown, cookie = "") {
    const response = await auth.handler(new Request(`${appUrl}/api/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { origin: appUrl, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const sessionCookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    if (sessionCookie) cookies.push(sessionCookie);
    return { response, sessionCookie };
  }

  async function createAccount(email: string, name: string) {
    const signup = await authRequest("sign-up/email", { name, email, password: "long-password-123", callbackURL: "/app" });
    expect(signup.response.ok).toBe(true);
    expect(signup.sessionCookie).not.toBe("");
    return signup.sessionCookie;
  }

  async function patch(id: string, cookie: string, body: unknown, headers: HeadersInit = { origin: appUrl, "content-type": "application/json" }) {
    context.cookie = cookie;
    const response = await patchMonitor(new Request(`${appUrl}/api/monitors/${id}`, {
      method: "PATCH", headers, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id }) });
    return { response, json: await response.json() as { monitor: MonitorRecord } };
  }

  it("persists drafts and ready state, supports withdrawal/reactivation, and blocks cross-workspace IDs", async () => {
    const cookieA = await createAccount(emailA, "Monitor Ada");
    context.cookie = cookieA;
    sourceValidation.validate.mockClear();

    const created = await postMonitor(new Request(`${appUrl}/api/monitors`, {
      method: "POST", headers: { origin: appUrl, "content-type": "application/json" },
      body: JSON.stringify({ name: "Billing API", contractUrl: "https://api.example.test/invalid/openapi.yaml", repositoryUrl: "https://github.com/example/billing.git" }),
    }));
    const draftBody = await created.json() as { monitor: MonitorRecord };
    const monitorId = draftBody.monitor.id;
    expect(created.status).toBe(201);
    expect(draftBody.monitor.status).toBe("DRAFT");
    expect(draftBody.monitor.contractError).toBe("OpenAPI document could not be read.");

    const querySpies = [
      vi.spyOn(db.monitor, "findMany"),
      vi.spyOn(db.checkRun, "findFirst"),
      vi.spyOn(db.contractSnapshot, "findUnique"),
      vi.spyOn(db.workspace, "findUnique"),
    ];
    const listStartedAt = performance.now();
    const draftRefresh = await getMonitors();
    const listElapsedMs = performance.now() - listStartedAt;
    const ormCalls = querySpies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    querySpies.forEach((spy) => spy.mockRestore());
    const listedMonitors = (await draftRefresh.json() as { monitors: MonitorRecord[] }).monitors;
    console.info(`[monitor-list-baseline] rows=${listedMonitors.length} orm_calls=${ormCalls} elapsed_ms=${listElapsedMs.toFixed(2)}`);
    const persistedDraft = listedMonitors[0];
    expect(listedMonitors).toHaveLength(1);
    expect(persistedDraft.id).toBe(monitorId);
    expect(persistedDraft.status).toBe("DRAFT");
    expect(persistedDraft.contractError).toBe("OpenAPI document could not be read.");

    const localhostEdit = await patch(monitorId, cookieA, {
      name: "Billing API", contractUrl: "https://api.example.test/invalid/openapi.yaml", repositoryUrl: "https://github.com/example/billing.git",
    }, { origin: "http://localhost:3000", "content-type": "application/json" });
    expect(localhostEdit.response.status).toBe(200);

    sourceValidation.validate.mockClear();
    for (const { headers, status } of [
      { headers: { "content-type": "application/json" }, status: 403 },
      { headers: { origin: "https://attacker.example", "content-type": "application/json" }, status: 403 },
      { headers: { origin: "http://localhost:3001", "content-type": "application/json" }, status: 403 },
      { headers: { origin: appUrl, "content-type": "text/plain" }, status: 415 },
    ]) {
      const response = await postMonitor(new Request(`${appUrl}/api/monitors`, {
        method: "POST", headers, body: JSON.stringify({ name: "Must not save", contractUrl: "https://api.example.test/openapi.yaml", repositoryUrl: "https://github.com/example/new.git" }),
      }));
      expect(response.status).toBe(status);
    }
    for (const { headers, status } of [
      { headers: { "content-type": "application/json" }, status: 403 },
      { headers: { origin: "https://attacker.example", "content-type": "application/json" }, status: 403 },
      { headers: { origin: "http://localhost:3001", "content-type": "application/json" }, status: 403 },
      { headers: { origin: appUrl, "content-type": "text/plain" }, status: 415 },
    ]) {
      const result = await patch(monitorId, cookieA, { name: "Must not overwrite", contractUrl: "https://api.example.test/openapi.yaml", repositoryUrl: "https://github.com/example/changed.git" }, headers);
      expect(result.response.status).toBe(status);
    }
    expect(sourceValidation.validate).not.toHaveBeenCalled();
    context.cookie = cookieA;
    const unchanged = await getMonitors();
    const afterRejectedWrites = (await unchanged.json() as { monitors: MonitorRecord[] }).monitors;
    expect(afterRejectedWrites).toHaveLength(1);
    expect(afterRejectedWrites[0].status).toBe("DRAFT");
    expect(afterRejectedWrites[0].contractUrl).toBe("https://api.example.test/invalid/openapi.yaml");

    const tooLarge = () => new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(8 * 1024 + 1)); controller.close(); },
    });
    const oversizedPost = await postMonitor(new Request(`${appUrl}/api/monitors`, {
      method: "POST", headers: { origin: appUrl, "content-type": "application/json" }, body: tooLarge(), duplex: "half",
    } as RequestInit & { duplex: "half" }));
    expect(oversizedPost.status).toBe(413);
    const oversizedPatch = await patchMonitor(new Request(`${appUrl}/api/monitors/${monitorId}`, {
      method: "PATCH", headers: { origin: appUrl, "content-type": "application/json" }, body: tooLarge(), duplex: "half",
    } as RequestInit & { duplex: "half" }), { params: Promise.resolve({ id: monitorId }) });
    expect(oversizedPatch.status).toBe(413);
    expect(sourceValidation.validate).not.toHaveBeenCalled();
    context.cookie = cookieA;
    expect((await getMonitors().then((response) => response.json()) as { monitors: MonitorRecord[] }).monitors).toHaveLength(1);

    await authRequest("sign-out", {}, cookieA);
    const login = await authRequest("sign-in/email", { email: emailA, password: "long-password-123" });
    const cookieAfterLogin = login.sessionCookie;
    expect(cookieAfterLogin).not.toBe("");
    context.cookie = cookieAfterLogin;
    const afterLogin = await getMonitors();
    expect((await afterLogin.json() as { monitors: MonitorRecord[] }).monitors[0].id).toBe(monitorId);

    const cookieB = await createAccount(emailB, "Monitor Grace");
    context.cookie = cookieB;
    expect((await getMonitors().then((response) => response.json()) as { monitors: unknown[] }).monitors).toHaveLength(0);
    const denied = await patch(monitorId, cookieB, { action: "withdraw" });
    expect(denied.response.status).toBe(404);

    const ready = await patch(monitorId, cookieAfterLogin, {
      name: "Billing API", contractUrl: "https://api.example.test/openapi.yaml", repositoryUrl: "https://github.com/example/billing.git",
    });
    expect(ready.json.monitor.status).toBe("READY");

    sourceValidation.validate.mockClear();
    const withdrawn = await patch(monitorId, cookieAfterLogin, { action: "withdraw" });
    expect(withdrawn.json.monitor.status).toBe("WITHDRAWN");
    expect(withdrawn.json.monitor.contractUrl).toBe("https://api.example.test/openapi.yaml");
    expect(sourceValidation.validate).not.toHaveBeenCalled();

    const reactivated = await patch(monitorId, cookieAfterLogin, { action: "reactivate" });
    expect(reactivated.json.monitor.status).toBe("READY");
    expect(sourceValidation.validate).toHaveBeenCalledTimes(1);

    let resolveSlowValidation!: (value: Awaited<ReturnType<typeof sourceValidation.validate>>) => void;
    let markValidationStarted!: () => void;
    const validationStarted = new Promise<void>((resolve) => { markValidationStarted = resolve; });
    sourceValidation.validate.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSlowValidation = resolve;
      markValidationStarted();
    }));
    const pendingEdit = patch(monitorId, cookieAfterLogin, {
      name: "Billing API", contractUrl: "https://api.example.test/slow.yaml", repositoryUrl: "https://github.com/example/billing.git",
    });
    await validationStarted;
    const withdrawDuringValidation = await patch(monitorId, cookieAfterLogin, { action: "withdraw" });
    expect(withdrawDuringValidation.json.monitor.status).toBe("WITHDRAWN");
    resolveSlowValidation({
      contract: { valid: true, error: null },
      repository: { valid: true, error: null },
    });
    const staleEdit = await pendingEdit;
    expect(staleEdit.json.monitor.status).toBe("WITHDRAWN");
    const afterRace = await getMonitors();
    expect((await afterRace.json() as { monitors: MonitorRecord[] }).monitors[0].status).toBe("WITHDRAWN");
    expect(cookies.length).toBeGreaterThanOrEqual(3);
  });
});
