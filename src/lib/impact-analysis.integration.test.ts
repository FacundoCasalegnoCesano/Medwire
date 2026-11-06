import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { ImpactCoverage, ImpactEvidence } from "@/lib/impact-types";
import type { CheckFinding } from "@/lib/monitor-check-types";

const requestContext = vi.hoisted(() => ({ cookie: "" }));
const sourceState = vi.hoisted(() => ({
  resolve: vi.fn<(repositoryUrl: string) => Promise<{ commitSha: string }>>(),
  read: vi.fn<(input: { repositoryUrl: string; commitSha: string }) => Promise<{ files: Array<{ path: string; content: string }>; coverage: ImpactCoverage }>>(),
}));
const analyzerState = vi.hoisted(() => ({
  analyze: vi.fn<(input: {
    previousContract: unknown; nextContract: unknown; repositoryUrl: string; contractUrl: string; commitSha: string;
    findings: CheckFinding[]; files: ReadonlyArray<{ path: string; content: string }>; coverage: ImpactCoverage;
  }) => Promise<{ evidence: ImpactEvidence[]; coverage: ImpactCoverage }>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: requestContext.cookie }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string): never => { throw new Error(`NEXT_REDIRECT:${path}`); } }));
vi.mock("@/lib/impact-repository", () => ({
  ImpactSourceError: class ImpactSourceError extends Error { constructor(readonly code: string, message: string) { super(message); } },
  resolveRepositoryRevision: sourceState.resolve,
  readRepositoryFiles: sourceState.read,
}));
vi.mock("@/lib/impact-analyzer", () => ({ analyzeContractImpact: analyzerState.analyze }));

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
const emails = Array.from({ length: 14 }, () => `impact-${randomUUID()}@example.test`);
const contractUrl = "https://api.example.test/openapi.yaml";
const repositoryUrl = "https://github.com/example/widgets.git";
const commitA = "a".repeat(40);
const defaultCoverage: ImpactCoverage = { source: "SUPPORTED", filesDiscovered: 1, filesAnalyzed: 1, filesSkipped: 0, reasons: [] };
const evidence: ImpactEvidence = {
  id: "evidence-1",
  classification: "CONFIRMED",
  repositoryUrl: "https://github.com/example/widgets",
  commitSha: commitA,
  filePath: "src/widgets.ts",
  startLine: 8,
  endLine: 9,
  snippet: "fetch('https://api.example.test/v1/widgets')",
  client: "fetch",
  method: "GET",
  requestPath: "/v1/widgets",
  contractElement: { method: "GET", path: "/v1/widgets", changeCode: "api-path-removed-without-deprecation" },
  reason: null,
};

describe("impact analysis API and worker with PostgreSQL fixture", () => {
  let db = undefined as unknown as typeof import("@/lib/db").db;
  let auth = undefined as unknown as typeof import("@/lib/auth").auth;
  let postImpact: typeof import("@/app/api/monitors/[id]/checks/[runId]/impact/route").POST;
  let getImpact: typeof import("@/app/api/monitors/[id]/checks/[runId]/impact/route").GET;
  let processImpactAnalysis: typeof import("@/lib/impact-analysis").processImpactAnalysis;
  let dispatchDueImpactAnalyses: typeof import("@/lib/impact-analysis").dispatchDueImpactAnalyses;
  const ownedMonitorIds = new Set<string>();
  const cookiesByAccount: string[] = [];

  beforeAll(async () => {
    process.env.MENDWIRE_BETA_ANALYSES_PER_MONTH = "1";
    ({ db } = await import("@/lib/db"));
    ({ auth } = await import("@/lib/auth"));
    ({ POST: postImpact, GET: getImpact } = await import("@/app/api/monitors/[id]/checks/[runId]/impact/route"));
    ({ processImpactAnalysis, dispatchDueImpactAnalyses } = await import("@/lib/impact-analysis"));
    await db.$connect();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    sourceState.resolve.mockResolvedValue({ commitSha: commitA });
    sourceState.read.mockResolvedValue({ files: [{ path: "src/widgets.ts", content: "fetch('https://api.example.test/v1/widgets')" }], coverage: defaultCoverage });
    analyzerState.analyze.mockResolvedValue({ evidence: [evidence], coverage: defaultCoverage });
  });

  afterAll(async () => {
    if (!db?.$disconnect) return;
    const monitors = [...ownedMonitorIds];
    if (monitors.length) {
      const runs = await db.checkRun.findMany({ where: { monitorId: { in: monitors } }, select: { id: true, impactAnalysis: { select: { id: true } } } });
      const analysisIds = runs.flatMap((run) => run.impactAnalysis ? [run.impactAnalysis.id] : []);
      if (analysisIds.length) {
        await db.$executeRaw`DELETE FROM pgboss.job WHERE name = 'monitor-impact-analysis' AND data->>'analysisId' = ANY(${analysisIds})`;
      }
    }
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.$disconnect();
  });

  async function createAccount(index: number) {
    if (cookiesByAccount[index]) {
      const user = await db.user.findUniqueOrThrow({ where: { email: emails[index] } });
      const workspace = await db.workspace.findUniqueOrThrow({ where: { ownerId: user.id } });
      requestContext.cookie = cookiesByAccount[index];
      return { user, workspace };
    }
    const response = await auth.handler(new Request(`${appUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin: appUrl, "content-type": "application/json" },
      body: JSON.stringify({ name: `Impact ${index}`, email: emails[index], password: "long-password-123", callbackURL: "/app" }),
    }));
    expect(response.ok).toBe(true);
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(cookie).not.toBe("");
    const user = await db.user.findUniqueOrThrow({ where: { email: emails[index] } });
    const workspace = await db.workspace.upsert({
      where: { ownerId: user.id },
      create: { ownerId: user.id, name: `Impact ${index}'s workspace` },
      update: {},
    });
    cookiesByAccount[index] = cookie;
    requestContext.cookie = cookie;
    return { user, workspace };
  }

  async function createBreakingRun(index: number, name: string) {
    const { workspace } = await createAccount(index);
    const monitor = await db.monitor.create({
      data: { workspaceId: workspace.id, name, contractUrl, repositoryUrl, status: "READY", contractVersion: 1 },
    });
    ownedMonitorIds.add(monitor.id);
    const previous = await db.contractSnapshot.create({
      data: {
        monitorId: monitor.id, contractVersion: 1, revisionId: "1".repeat(64), contractUrl, specVersion: "3.0.3",
        document: { openapi: "3.0.3", info: { title: name, version: "1" }, servers: [{ url: "https://api.example.test" }], paths: { "/v1/widgets": { get: {} } } },
      },
    });
    const next = await db.contractSnapshot.create({
      data: {
        monitorId: monitor.id, contractVersion: 1, revisionId: "2".repeat(64), contractUrl, specVersion: "3.0.3",
        document: { openapi: "3.0.3", info: { title: name, version: "2" }, paths: {} },
      },
    });
    const run = await db.checkRun.create({
      data: {
        monitorId: monitor.id, contractVersion: 1, contractUrl, trigger: "MANUAL", idempotencyKey: randomUUID(),
        status: "SUCCESS", outcome: "CHANGES_FOUND", previousSnapshotId: previous.id, newSnapshotId: next.id,
        previousRevisionId: previous.revisionId, newRevisionId: next.revisionId,
        findings: [{ code: "api-path-removed-without-deprecation", location: "paths./v1/widgets.get", method: "GET", path: "/v1/widgets", summary: "Endpoint removed", severity: "BREAKING" }],
        completedAt: new Date(),
      },
    });
    return { monitor, run };
  }

  async function post(monitorId: string, runId: string, key = randomUUID()) {
    const response = await postImpact(new Request(`${appUrl}/api/monitors/${monitorId}/checks/${runId}/impact`, {
      method: "POST",
      headers: { origin: appUrl, "content-type": "application/json", "idempotency-key": key },
      body: "{}",
    }), { params: Promise.resolve({ id: monitorId, runId }) });
    return { response, body: await response.json() as { analysis?: { id: string; status: string; commitSha: string | null; coverage?: ImpactCoverage }; error?: string } };
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
  }

  it("pins the repository commit before background reads, and serves owned evidence", async () => {
    const { monitor, run } = await createBreakingRun(0, "Pinned source");
    const key = randomUUID();
    const queued = await post(monitor.id, run.id, key);
    expect(queued.response.status, queued.body.error).toBe(202);
    expect(queued.body.analysis).toMatchObject({ status: "QUEUED", commitSha: commitA });
    expect(sourceState.resolve).toHaveBeenCalledOnce();
    expect(sourceState.read).not.toHaveBeenCalled();

    const analysisId = queued.body.analysis!.id;
    const invalidOrigin = await postImpact(new Request(`${appUrl}/api/monitors/${monitor.id}/checks/${run.id}/impact`, {
      method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json", "idempotency-key": randomUUID() }, body: "{}",
    }), { params: Promise.resolve({ id: monitor.id, runId: run.id }) });
    expect(invalidOrigin.status).toBe(403);
    const persistedJobs = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM pgboss.job WHERE name = 'monitor-impact-analysis' AND data->>'analysisId' = ${analysisId}
    `;
    expect(persistedJobs.length).toBeGreaterThan(0);

    const duplicate = await post(monitor.id, run.id, key);
    expect(duplicate.body.analysis?.id).toBe(analysisId);
    expect(sourceState.resolve).toHaveBeenCalledOnce();
    expect(await db.impactAnalysisRequest.count({ where: { analysisId } })).toBe(1);

    await processImpactAnalysis(analysisId);
    expect(sourceState.read).toHaveBeenCalledWith({ repositoryUrl, commitSha: commitA });
    const { getMonitor, listMonitors } = await import("@/lib/monitors");
    const reloadedMonitor = await getMonitor(monitor.id);
    expect(reloadedMonitor.lastRun?.impactAnalysis).toMatchObject({ id: analysisId, status: "SUCCESS" });
    const listedMonitor = (await listMonitors()).find((item) => item.id === monitor.id);
    expect(listedMonitor?.lastRun?.impactAnalysis).toMatchObject({ id: analysisId, status: "SUCCESS" });
    const history = await getImpact(new Request(`${appUrl}/api/monitors/${monitor.id}/checks/${run.id}/impact`), {
      params: Promise.resolve({ id: monitor.id, runId: run.id }),
    });
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({ analysis: { status: "SUCCESS", commitSha: commitA, evidence: [{ startLine: 8, filePath: "src/widgets.ts" }] } });

    await createAccount(1);
    expect((await post(monitor.id, run.id)).response.status).toBe(404);
    const denied = await getImpact(new Request(`${appUrl}/api/monitors/${monitor.id}/checks/${run.id}/impact`), {
      params: Promise.resolve({ id: monitor.id, runId: run.id }),
    });
    expect(denied.status).toBe(404);
  });

  it("runs the real analyzer against pinned files and persists confirmed endpoint evidence", async () => {
    const { analyzeContractImpact } = await vi.importActual<typeof import("@/lib/impact-analyzer")>("@/lib/impact-analyzer");
    const { monitor, run } = await createBreakingRun(4, "Real analyzer");
    analyzerState.analyze.mockImplementationOnce(async (input) => analyzeContractImpact(input));
    const queued = await post(monitor.id, run.id);
    const analysisId = queued.body.analysis!.id;

    await processImpactAnalysis(analysisId);

    const persisted = await db.impactAnalysis.findUniqueOrThrow({ where: { id: analysisId } });
    expect(persisted.status).toBe("SUCCESS");
    expect(persisted.evidence).toMatchObject([{ classification: "CONFIRMED", commitSha: commitA, filePath: "src/widgets.ts", method: "GET", requestPath: "/v1/widgets" }]);
  });

  it("retries a failed analysis on the stored commit and does not count the retry twice", async () => {
    const { monitor, run } = await createBreakingRun(2, "Retry pinned source");
    const queued = await post(monitor.id, run.id);
    const analysisId = queued.body.analysis!.id;
    sourceState.resolve.mockResolvedValue({ commitSha: "b".repeat(40) });
    sourceState.read.mockRejectedValue(new Error("temporary read failure"));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { await processImpactAnalysis(analysisId); } catch { /* the durable row is queued for the next bounded attempt */ }
    }
    const failed = await db.impactAnalysis.findUniqueOrThrow({ where: { id: analysisId } });
    expect(failed.status).toBe("FAILURE");
    expect(failed.commitSha).toBe(commitA);
    await db.impactAnalysis.update({ where: { id: analysisId }, data: { analyzerVersion: "impact-ts-v1" } });
    await db.$executeRaw`DELETE FROM pgboss.job WHERE name = 'monitor-impact-analysis' AND data->>'analysisId' = ${analysisId}`;

    sourceState.read.mockResolvedValue({ files: [{ path: "src/widgets.ts", content: "fetch('/v1/widgets')" }], coverage: defaultCoverage });
    const retry = await post(monitor.id, run.id, randomUUID());
    expect(retry.response.status).toBe(202);
    expect(retry.body.analysis).toMatchObject({ id: analysisId, status: "QUEUED", commitSha: commitA });
    await processImpactAnalysis(analysisId);
    expect(sourceState.resolve).toHaveBeenCalledOnce();
    expect(sourceState.read).toHaveBeenLastCalledWith({ repositoryUrl, commitSha: commitA });
    expect(await db.impactAnalysis.findUniqueOrThrow({ where: { id: analysisId } })).toMatchObject({ analyzerVersion: "impact-ts-v3" });
    expect(await db.impactAnalysis.count({ where: { workspaceId: failed.workspaceId } })).toBe(1);
  });

  it("reports unsupported repository hosts as explicit coverage without changing monitor readiness", async () => {
    const { monitor, run } = await createBreakingRun(3, "Unsupported host");
    const { ImpactSourceError } = await import("@/lib/impact-repository");
    sourceState.resolve.mockRejectedValue(new ImpactSourceError("UNSUPPORTED_SOURCE", "unsupported"));
    const { response, body } = await post(monitor.id, run.id);
    expect(response.status).toBe(202);
    expect(body.analysis).toMatchObject({ status: "SUCCESS", commitSha: null, coverage: { source: "UNSUPPORTED" } });
    expect(await db.monitor.findUniqueOrThrow({ where: { id: monitor.id } })).toMatchObject({ status: "READY" });
    expect(sourceState.read).not.toHaveBeenCalled();
  });

  it.each([
    { label: "withdrawal", mutate: async (monitorId: string, workspaceId: string) => { await db.monitor.updateMany({ where: { id: monitorId, workspaceId }, data: { status: "WITHDRAWN" } }); } },
    { label: "repository edit", mutate: async (monitorId: string, workspaceId: string) => { await db.monitor.updateMany({ where: { id: monitorId, workspaceId }, data: { repositoryUrl: "https://github.com/example/changed.git" } }); } },
    { label: "entitlement revocation", mutate: async (monitorId: string, workspaceId: string) => { await db.workspace.update({ where: { id: workspaceId }, data: { entitlementState: "EXPIRED" } }); } },
  ])("fails closed when $label happens during repository read", async ({ label, mutate }) => {
    const accountIndex = label === "withdrawal" ? 5 : label === "repository edit" ? 6 : 7;
    const { monitor, run } = await createBreakingRun(accountIndex, `Race ${label}`);
    const queued = await post(monitor.id, run.id);
    const analysisId = queued.body.analysis!.id;
    const gate = deferred<{ files: Array<{ path: string; content: string }>; coverage: ImpactCoverage }>();
    sourceState.read.mockReturnValueOnce(gate.promise);
    const running = processImpactAnalysis(analysisId);
    await vi.waitFor(() => expect(sourceState.read).toHaveBeenCalledOnce());
    await mutate(monitor.id, monitor.workspaceId);
    gate.resolve({ files: [{ path: "src/widgets.ts", content: "fetch('https://api.example.test/v1/widgets')" }], coverage: defaultCoverage });
    await running;
    const persisted = await db.impactAnalysis.findUniqueOrThrow({ where: { id: analysisId } });
    expect(persisted.status).toBe("FAILURE");
    expect(persisted.evidence).toEqual([]);
  });

  it("serializes the final monthly analysis allowance across concurrent requests", async () => {
    const first = await createBreakingRun(8, "Quota first");
    const second = await createBreakingRun(8, "Quota second");
    const [left, right] = await Promise.all([post(first.monitor.id, first.run.id), post(second.monitor.id, second.run.id)]);
    expect([left.response.status, right.response.status].sort((a, b) => a - b)).toEqual([202, 429]);
    expect(await db.impactAnalysis.count({ where: { workspaceId: first.monitor.workspaceId } })).toBe(1);
  });

  it("rejects an already exhausted quota before resolving repository HEAD", async () => {
    const first = await createBreakingRun(11, "Quota fill");
    const second = await createBreakingRun(11, "Quota blocked before fetch");
    expect((await post(first.monitor.id, first.run.id)).response.status).toBe(202);
    sourceState.resolve.mockClear();

    const rejected = await post(second.monitor.id, second.run.id);

    expect(rejected.response.status).toBe(429);
    expect(sourceState.resolve).not.toHaveBeenCalled();
    expect(await db.impactAnalysis.count({ where: { workspaceId: first.monitor.workspaceId } })).toBe(1);
  });

  it.each([
    { phase: "worker validation", failingCall: 1, accountIndex: 12 },
    { phase: "final persistence", failingCall: 2, accountIndex: 13 },
  ])("retries an unexpected entitlement lookup error during $phase", async ({ failingCall, accountIndex }) => {
    const { monitor, run } = await createBreakingRun(accountIndex, `Transient entitlement ${accountIndex}`);
    const queued = await post(monitor.id, run.id);
    const analysisId = queued.body.analysis!.id;
    const policy = await import("@/lib/beta-policy");
    const originalAssertCapability = policy.assertWorkspaceCapability;
    let calls = 0;
    const capabilitySpy = vi.spyOn(policy, "assertWorkspaceCapability").mockImplementation(async (input) => {
      calls += 1;
      if (calls === failingCall) throw new Error("temporary entitlement database failure");
      return originalAssertCapability(input);
    });

    try {
      await expect(processImpactAnalysis(analysisId)).rejects.toThrow("remains queued for bounded retry");
    } finally {
      capabilitySpy.mockRestore();
    }

    expect(calls).toBeGreaterThanOrEqual(failingCall);
    expect(await db.impactAnalysis.findUniqueOrThrow({ where: { id: analysisId } })).toMatchObject({ status: "QUEUED", attempts: 1, evidence: [] });
  });

  it("ignores duplicate active leases and reclaims one expired lease", async () => {
    const { monitor, run } = await createBreakingRun(9, "Lease reclaim");
    const queued = await post(monitor.id, run.id);
    const analysisId = queued.body.analysis!.id;
    const gate = deferred<{ files: Array<{ path: string; content: string }>; coverage: ImpactCoverage }>();
    sourceState.read.mockReturnValue(gate.promise);
    const firstWorker = processImpactAnalysis(analysisId);
    await vi.waitFor(() => expect(sourceState.read).toHaveBeenCalledOnce());
    await processImpactAnalysis(analysisId);
    expect(sourceState.read).toHaveBeenCalledOnce();
    await db.impactAnalysis.update({ where: { id: analysisId }, data: { leaseExpiresAt: new Date(Date.now() - 10_000) } });
    const reclaimedWorker = processImpactAnalysis(analysisId);
    await vi.waitFor(() => expect(sourceState.read).toHaveBeenCalledTimes(2));
    gate.resolve({ files: [{ path: "src/widgets.ts", content: "fetch('https://api.example.test/v1/widgets')" }], coverage: defaultCoverage });
    await Promise.all([firstWorker, reclaimedWorker]);
    expect(await db.impactAnalysis.findUniqueOrThrow({ where: { id: analysisId } })).toMatchObject({ status: "SUCCESS", attempts: 2 });
  });

  it("terminalizes an expired lease at the attempt ceiling during dispatcher recovery", async () => {
    const { monitor, run } = await createBreakingRun(10, "Lease ceiling");
    const queued = await post(monitor.id, run.id);
    const analysisId = queued.body.analysis!.id;
    await db.impactAnalysis.update({
      where: { id: analysisId },
      data: { status: "RUNNING", attempts: 4, claimToken: randomUUID(), leaseExpiresAt: new Date(Date.now() - 10_000) },
    });
    await dispatchDueImpactAnalyses();
    expect(await db.impactAnalysis.findUniqueOrThrow({ where: { id: analysisId } })).toMatchObject({ status: "FAILURE", attempts: 4, leaseExpiresAt: null, claimToken: null });
  });
});
