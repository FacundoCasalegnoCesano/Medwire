import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  openApi30EndpointRemovedJson,
  openApi30Json,
  openApi31CompatibleYaml,
  openApi31DescriptionOnlyYaml,
  openApi31RequiredPropertyYaml,
} from "@/lib/monitor-check-fixtures";
import type { FetchedOpenApiContract } from "@/lib/monitor-sources";
import type { CheckFinding } from "@/lib/monitor-check-types";

const requestContext = vi.hoisted(() => ({ cookie: "" }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: requestContext.cookie }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string): never => { throw new Error(`NEXT_REDIRECT:${path}`); } }));
vi.mock("@/lib/monitor-sources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/monitor-sources")>();
  return {
    ...actual,
    validateMonitorSources: async () => ({
      contract: { valid: true, error: null },
      repository: { valid: true, error: null },
    }),
  };
});

const testDatabaseUrl = process.env.AUTH_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("Set AUTH_TEST_DATABASE_URL to a dedicated local test database before running test:integration");
}
const testDatabase = new URL(testDatabaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(testDatabase.hostname) || !testDatabase.pathname.endsWith("_test")) {
  throw new Error("AUTH_TEST_DATABASE_URL must use a loopback host and a database name ending in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.BETTER_AUTH_URL = process.env.AUTH_TEST_BASE_URL ?? "http://127.0.0.1:3000";
process.env.BETTER_AUTH_SECRET = "test-only-secret-that-is-long-enough-for-better-auth";
process.env.MENDWIRE_MANUAL_CHECK_COOLDOWN_SECONDS = "1";
process.env.MENDWIRE_BETA_ACTIVE_MONITORS = "3";

const appUrl = process.env.BETTER_AUTH_URL!;
const emails = Array.from({ length: 4 }, () => `checks-${randomUUID()}@example.test`);
const contractUrl = "https://api.example.test/openapi.yaml";
const repositoryUrl = "https://github.com/example/widgets.git";

type StoredRun = {
  id: string;
  status: string;
  outcome: string | null;
  previousRevisionId: string | null;
  newRevisionId: string | null;
  previousSnapshotId: string | null;
  newSnapshotId: string | null;
  findings: unknown;
  error: string | null;
};

describe("monitor contract checks with PostgreSQL and oasdiff", () => {
  let db = undefined as unknown as typeof import("@/lib/db").db;
  let auth = undefined as unknown as typeof import("@/lib/auth").auth;
  let enqueueManualCheck: typeof import("@/lib/monitor-checks").enqueueManualCheck;
  let dispatchDueMonitorChecks: typeof import("@/lib/monitor-checks").dispatchDueMonitorChecks;
  let processMonitorCheckRun: typeof import("@/lib/monitor-checks").processMonitorCheckRun;
  let startMonitorWorker: typeof import("@/lib/monitor-queue").startMonitorWorker;
  let stopMonitorWorker: typeof import("@/lib/monitor-queue").stopMonitorWorker;
  let createMonitorContractFetcher: typeof import("@/lib/monitor-sources").createMonitorContractFetcher;
  let postChecks: typeof import("@/app/api/monitors/[id]/checks/route").POST;
  let getChecks: typeof import("@/app/api/monitors/[id]/checks/route").GET;
  let createMonitor: typeof import("@/lib/monitors").createMonitor;
  let MonitorCapacityError: typeof import("@/lib/monitors").MonitorCapacityError;
  let compareOpenApiDocuments: typeof import("@/lib/openapi-diff").compareOpenApiDocuments;
  const contracts = new Map<string, { body: string; contentType: string; statusCode: number }>();
  let fetchCalls = 0;
  let fetcher: (url: string) => Promise<FetchedOpenApiContract>;
  const ownedMonitorIds = new Set<string>();
  const workspaceIds: string[] = [];
  const cookiesByAccount: string[] = [];

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    ({ auth } = await import("@/lib/auth"));
    ({ enqueueManualCheck, dispatchDueMonitorChecks, processMonitorCheckRun } = await import("@/lib/monitor-checks"));
    ({ startMonitorWorker, stopMonitorWorker } = await import("@/lib/monitor-queue"));
    ({ createMonitorContractFetcher } = await import("@/lib/monitor-sources"));
    ({ compareOpenApiDocuments } = await import("@/lib/openapi-diff"));
    ({ POST: postChecks, GET: getChecks } = await import("@/app/api/monitors/[id]/checks/route"));
    ({ createMonitor, MonitorCapacityError } = await import("@/lib/monitors"));
    await db.$connect();
    fetcher = createMonitorContractFetcher({
      resolve: async () => ["93.184.216.34"],
      request: async (url) => {
        fetchCalls += 1;
        const fixture = contracts.get(url.pathname);
        if (!fixture) return { statusCode: 404, headers: {}, body: new Uint8Array() };
        return {
          statusCode: fixture.statusCode,
          headers: { "content-type": fixture.contentType },
          body: Buffer.from(fixture.body),
        };
      },
    });
  });

  afterAll(async () => {
    if (!db?.$disconnect) return;
    await stopMonitorWorker?.();
    if (ownedMonitorIds.size > 0) {
      const runs = await db.checkRun.findMany({
        where: { monitorId: { in: [...ownedMonitorIds] } },
        select: { id: true },
      });
      const runIds = runs.map((run) => run.id);
      if (runIds.length > 0) {
        await db.$executeRaw`
          DELETE FROM pgboss.job
          WHERE name = 'monitor-check' AND data->>'runId' = ANY(${runIds})
        `;
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
      return { user, workspace, cookie: cookiesByAccount[index] };
    }
    const response = await auth.handler(new Request(`${appUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin: appUrl, "content-type": "application/json" },
      body: JSON.stringify({ name: `Checks ${index}`, email: emails[index], password: "long-password-123", callbackURL: "/app" }),
    }));
    expect(response.ok).toBe(true);
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(cookie).not.toBe("");
    const user = await db.user.findUniqueOrThrow({ where: { email: emails[index] } });
    const workspace = await db.workspace.upsert({
      where: { ownerId: user.id },
      create: { ownerId: user.id, name: `Checks ${index}'s workspace` },
      update: {},
    });
    workspaceIds[index] = workspace.id;
    cookiesByAccount[index] = cookie;
    requestContext.cookie = cookie;
    return { user, workspace, cookie };
  }

  async function createReadyMonitor(index: number, name: string) {
    const { workspace } = await createAccount(index);
    const monitor = await db.monitor.create({
      data: {
        workspaceId: workspace.id,
        name,
        contractUrl,
        repositoryUrl,
        status: "READY",
      },
    });
    ownedMonitorIds.add(monitor.id);
    return monitor;
  }

  async function queueAndProcess(monitorId: string, key: string, compare?: (previous: unknown, current: unknown) => Promise<CheckFinding[]>) {
    const queued = await enqueueManualCheck(monitorId, key);
    await processMonitorCheckRun(queued.id, { fetchContract: fetcher, ...(compare ? { compare } : {}) });
    return db.checkRun.findUniqueOrThrow({ where: { id: queued.id } }) as Promise<StoredRun>;
  }

  function installContract(path: string, body: string, contentType = "application/yaml", statusCode = 200) {
    contracts.set(path, { body, contentType, statusCode });
  }

  async function waitForManualCooldown() {
    await new Promise((resolve) => setTimeout(resolve, 1_050));
  }

  async function waitForRun(runId: string, status: string) {
    for (let attempt = 0; attempt < 1_200; attempt += 1) {
      const run = await db.checkRun.findUniqueOrThrow({ where: { id: runId } });
      if (run.status === status) return run;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const run = await db.checkRun.findUniqueOrThrow({ where: { id: runId } });
    const jobs = await db.$queryRaw<{ state: string; data: unknown }[]>`
      SELECT state, data FROM pgboss.job
      WHERE name = 'monitor-check' AND data->>'runId' = ${runId}
    `;
    throw new Error(`Check run ${runId} did not reach ${status}; state=${run.status}; attempts=${run.attempts}; error=${run.error}; jobs=${JSON.stringify(jobs)}.`);
  }

  it("saves baselines and every valid 3.0/3.1 revision, reporting only breaking transitions", async () => {
    const monitor = await createReadyMonitor(0, "Widget API revisions");
    installContract("/openapi.yaml", openApi30Json, "application/json");

    const baseline = await queueAndProcess(monitor.id, "baseline");
    expect(baseline.status).toBe("SUCCESS");
    expect(baseline.outcome).toBe("BASELINE_SAVED");
    expect(baseline.previousRevisionId).toBeNull();
    expect(baseline.newRevisionId).toMatch(/^[a-f0-9]{64}$/);
    expect(baseline.findings).toEqual([]);
    await waitForManualCooldown();

    installContract("/openapi.yaml", openApi30EndpointRemovedJson, "application/json");
    const removed = await queueAndProcess(monitor.id, "endpoint-removed");
    expect(removed.outcome).toBe("CHANGES_FOUND");
    expect(removed.previousRevisionId).toBe(baseline.newRevisionId);
    expect(removed.newRevisionId).not.toBe(removed.previousRevisionId);
    expect(removed.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "GET", path: "/widgets", severity: "BREAKING" }),
    ]));
    await waitForManualCooldown();

    installContract("/openapi.yaml", openApi31CompatibleYaml);
    const compatible = await queueAndProcess(monitor.id, "compatible-addition");
    expect(compatible.outcome).toBe("NO_CHANGES");
    expect(compatible.findings).toEqual([]);
    expect(compatible.previousRevisionId).toBe(removed.newRevisionId);
    expect(compatible.newRevisionId).not.toBe(compatible.previousRevisionId);
    await waitForManualCooldown();

    installContract("/openapi.yaml", openApi31DescriptionOnlyYaml);
    const descriptionOnly = await queueAndProcess(monitor.id, "description-only");
    expect(descriptionOnly.outcome).toBe("NO_CHANGES");
    expect(descriptionOnly.findings).toEqual([]);
    expect(descriptionOnly.previousRevisionId).toBe(compatible.newRevisionId);
    expect(descriptionOnly.newRevisionId).not.toBe(descriptionOnly.previousRevisionId);
    await waitForManualCooldown();

    installContract("/openapi.yaml", openApi31RequiredPropertyYaml);
    const requiredProperty = await queueAndProcess(monitor.id, "required-property");
    expect(requiredProperty.outcome).toBe("CHANGES_FOUND");
    expect(requiredProperty.previousRevisionId).toBe(descriptionOnly.newRevisionId);
    expect(requiredProperty.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "POST", path: "/widgets", severity: "BREAKING" }),
    ]));

    const snapshots = await db.contractSnapshot.findMany({ where: { monitorId: monitor.id }, orderBy: { contractVersion: "asc" } });
    expect(snapshots.map((snapshot) => snapshot.revisionId)).toEqual([
      baseline.newRevisionId,
      removed.newRevisionId,
      compatible.newRevisionId,
      descriptionOnly.newRevisionId,
      requiredProperty.newRevisionId,
    ]);
    const state = await db.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(state.lastSuccessfulCheckAt).toBeInstanceOf(Date);
    expect(state.nextCheckAt).toBeInstanceOf(Date);
  }, 30_000);

  it("records invalid or failed fetches without replacing the last valid baseline", async () => {
    const monitor = await createReadyMonitor(1, "Failure preserves baseline");
    installContract("/openapi.yaml", openApi30Json, "application/json");
    const baseline = await queueAndProcess(monitor.id, "good-baseline");
    const savedBefore = await db.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    await waitForManualCooldown();

    installContract("/openapi.yaml", "openapi: [invalid", "application/yaml");
    const invalid = await queueAndProcess(monitor.id, "invalid-document");
    expect(invalid.status).toBe("FAILURE");
    expect(invalid.newRevisionId).toBeNull();
    const afterInvalid = await db.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(afterInvalid.currentRevisionId).toBe(savedBefore.currentRevisionId);
    expect(afterInvalid.contractVersion).toBe(savedBefore.contractVersion);
    expect(await db.contractSnapshot.count({ where: { monitorId: monitor.id } })).toBe(1);
    await waitForManualCooldown();

    installContract("/openapi.yaml", "upstream unavailable", "text/plain", 503);
    const failedFetch = await queueAndProcess(monitor.id, "http-failure");
    expect(failedFetch.status).toBe("FAILURE");
    const afterHttpFailure = await db.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(afterHttpFailure.currentRevisionId).toBe(savedBefore.currentRevisionId);
    expect(afterHttpFailure.contractVersion).toBe(savedBefore.contractVersion);
    expect(await db.contractSnapshot.count({ where: { monitorId: monitor.id } })).toBe(1);
    expect(baseline.outcome).toBe("BASELINE_SAVED");
  });

  it("dispatches due scheduled checks from persisted state without a browser request", async () => {
    const monitor = await createReadyMonitor(1, "Scheduled check");
    installContract("/openapi.yaml", openApi30Json, "application/json");
    await db.monitor.update({ where: { id: monitor.id }, data: { nextCheckAt: new Date(Date.now() - 1_000) } });

    await dispatchDueMonitorChecks();
    const scheduledRuns = await db.checkRun.findMany({ where: { monitorId: monitor.id } });
    expect(scheduledRuns).toHaveLength(1);
    expect(scheduledRuns[0].trigger).toBe("SCHEDULED");
    expect(scheduledRuns[0].status).toBe("QUEUED");
    await dispatchDueMonitorChecks();
    expect(await db.checkRun.count({ where: { monitorId: monitor.id } })).toBe(1);

    await processMonitorCheckRun(scheduledRuns[0].id, { fetchContract: fetcher });
    const completed = await db.checkRun.findUniqueOrThrow({ where: { id: scheduledRuns[0].id } });
    const refreshed = await db.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(completed.status).toBe("SUCCESS");
    expect(completed.outcome).toBe("BASELINE_SAVED");
    expect(refreshed.nextCheckAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it("retains a fetched transition after comparison failure and retries it without fetching again", async () => {
    const monitor = await createReadyMonitor(0, "Retry transition");
    installContract("/openapi.yaml", openApi30Json, "application/json");
    const baseline = await queueAndProcess(monitor.id, "retry-baseline");
    await waitForManualCooldown();
    installContract("/openapi.yaml", openApi30EndpointRemovedJson, "application/json");

    const callsBeforeFailure = fetchCalls;
    const failed = await queueAndProcess(monitor.id, "compare-fails", async () => { throw new Error("controlled comparator failure"); });
    expect(failed.status).toBe("FAILURE");
    expect(failed.previousRevisionId).toBe(baseline.newRevisionId);
    expect(failed.newRevisionId).toMatch(/^[a-f0-9]{64}$/);
    expect(failed.newSnapshotId).toBeTruthy();
    const savedDuringFailure = await db.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(savedDuringFailure.currentRevisionId).toBe(baseline.newSnapshotId);
    expect(fetchCalls).toBe(callsBeforeFailure + 1);
    await waitForManualCooldown();

    const retried = await queueAndProcess(monitor.id, "compare-retry");
    expect(retried.status).toBe("SUCCESS");
    expect(retried.outcome).toBe("CHANGES_FOUND");
    expect(retried.previousRevisionId).toBe(failed.previousRevisionId);
    expect(retried.newRevisionId).toBe(failed.newRevisionId);
    expect(retried.newSnapshotId).toBe(failed.newSnapshotId);
    expect(fetchCalls).toBe(callsBeforeFailure + 1);
  });

  it("stores a valid revision before diffing and leaves the baseline unchanged until comparison succeeds", async () => {
    const monitor = await createReadyMonitor(0, "Snapshot before diff");
    installContract("/openapi.yaml", openApi30Json, "application/json");
    const baseline = await queueAndProcess(monitor.id, "pre-diff-baseline");
    await waitForManualCooldown();
    installContract("/openapi.yaml", openApi31RequiredPropertyYaml);
    const queued = await enqueueManualCheck(monitor.id, "pre-diff-transition");

    let releaseDiff!: () => void;
    let markDiffStarted!: () => void;
    const diffStarted = new Promise<void>((resolve) => { markDiffStarted = resolve; });
    const controlledCompare: typeof compareOpenApiDocuments = async (previous, current) => {
      markDiffStarted();
      await new Promise<void>((resolve) => { releaseDiff = resolve; });
      return compareOpenApiDocuments(previous, current);
    };
    const running = processMonitorCheckRun(queued.id, { fetchContract: fetcher, compare: controlledCompare });
    await diffStarted;

    const snapshotsWhileComparing = await db.contractSnapshot.findMany({ where: { monitorId: monitor.id } });
    const runWhileComparing = await db.checkRun.findUniqueOrThrow({ where: { id: queued.id } });
    const monitorWhileComparing = await db.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(snapshotsWhileComparing).toHaveLength(2);
    expect(runWhileComparing.status).toBe("RUNNING");
    expect(runWhileComparing.previousRevisionId).toBe(baseline.newRevisionId);
    expect(runWhileComparing.newSnapshotId).toBeTruthy();
    expect(monitorWhileComparing.currentRevisionId).toBe(baseline.newSnapshotId);

    releaseDiff();
    await running;
    const completed = await db.checkRun.findUniqueOrThrow({ where: { id: queued.id } });
    const afterDiff = await db.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(completed.status).toBe("SUCCESS");
    expect(completed.outcome).toBe("CHANGES_FOUND");
    expect(afterDiff.currentRevisionId).toBe(completed.newSnapshotId);
  });

  it("deduplicates repeated delivery and serializes overlapping runs for the same monitor", async () => {
    const monitor = await createReadyMonitor(1, "Idempotent overlap");
    installContract("/openapi.yaml", openApi30Json, "application/json");
    const queued = await enqueueManualCheck(monitor.id, "duplicate-key");
    const duplicate = await enqueueManualCheck(monitor.id, "duplicate-key");
    expect(duplicate.id).toBe(queued.id);
    await expect(enqueueManualCheck(monitor.id, "second-active-key")).rejects.toMatchObject({ status: 409 });

    let releaseFetch!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const blockedFetcher = async (url: string) => {
      markStarted();
      await new Promise<void>((resolve) => { releaseFetch = resolve; });
      return fetcher(url);
    };
    const first = processMonitorCheckRun(queued.id, { fetchContract: blockedFetcher });
    await started;
    const overlapping = processMonitorCheckRun(queued.id, { fetchContract: blockedFetcher });
    releaseFetch();
    await Promise.all([first, overlapping]);

    expect(await db.checkRun.count({ where: { monitorId: monitor.id } })).toBe(1);
    expect(await db.contractSnapshot.count({ where: { monitorId: monitor.id } })).toBe(1);
    const finalRun = await db.checkRun.findUniqueOrThrow({ where: { id: queued.id } });
    expect(finalRun.status).toBe("SUCCESS");
    expect(finalRun.outcome).toBe("BASELINE_SAVED");
  });

  it("does not fetch a queued run after withdrawal or a source revision change", async () => {
    const withdrawnMonitor = await createReadyMonitor(0, "Withdrawn while queued");
    installContract("/openapi.yaml", openApi30Json, "application/json");
    const withdrawnRun = await enqueueManualCheck(withdrawnMonitor.id, "withdraw-pending");
    await db.monitor.update({ where: { id: withdrawnMonitor.id }, data: { status: "WITHDRAWN" } });
    const callsBeforeWithdrawnRun = fetchCalls;
    await processMonitorCheckRun(withdrawnRun.id, { fetchContract: fetcher });
    const stopped = await db.checkRun.findUniqueOrThrow({ where: { id: withdrawnRun.id } });
    expect(stopped.status).toBe("FAILURE");
    expect(fetchCalls).toBe(callsBeforeWithdrawnRun);

    const editedMonitor = await createReadyMonitor(1, "Source changed while queued");
    const staleRun = await enqueueManualCheck(editedMonitor.id, "source-change-pending");
    await db.monitor.update({
      where: { id: editedMonitor.id },
      data: { contractUrl: "https://api.example.test/replaced.yaml", contractVersion: { increment: 1 } },
    });
    const callsBeforeStaleRun = fetchCalls;
    await processMonitorCheckRun(staleRun.id, { fetchContract: fetcher });
    const stale = await db.checkRun.findUniqueOrThrow({ where: { id: staleRun.id } });
    expect(stale.status).toBe("FAILURE");
    expect(fetchCalls).toBe(callsBeforeStaleRun);
  });

  it("reclaims an expired worker lease without letting the older worker overwrite the saved transition", async () => {
    const monitor = await createReadyMonitor(0, "Expired worker lease");
    installContract("/openapi.yaml", openApi30Json, "application/json");
    const baseline = await queueAndProcess(monitor.id, "lease-baseline");
    await waitForManualCooldown();
    installContract("/openapi.yaml", openApi30EndpointRemovedJson, "application/json");
    const queued = await enqueueManualCheck(monitor.id, "lease-expired");

    let releaseFirstFetch!: () => void;
    let markFirstFetchStarted!: () => void;
    const firstFetchStarted = new Promise<void>((resolve) => { markFirstFetchStarted = resolve; });
    const delayedFetcher: typeof fetcher = async (url) => {
      markFirstFetchStarted();
      await new Promise<void>((resolve) => { releaseFirstFetch = resolve; });
      return fetcher(url);
    };
    const oldWorker = processMonitorCheckRun(queued.id, { fetchContract: delayedFetcher, leaseMs: 50 });
    await firstFetchStarted;
    await new Promise((resolve) => setTimeout(resolve, 75));
    await processMonitorCheckRun(queued.id, { fetchContract: fetcher, leaseMs: 50 });
    releaseFirstFetch();
    await oldWorker;

    const stored = await db.checkRun.findUniqueOrThrow({ where: { id: queued.id } });
    const monitorAfterReclaim = await db.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(stored.status).toBe("SUCCESS");
    expect(stored.outcome).toBe("CHANGES_FOUND");
    expect(stored.previousRevisionId).toBe(baseline.newRevisionId);
    expect(stored.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "GET", path: "/widgets", severity: "BREAKING" }),
    ]));
    expect(monitorAfterReclaim.currentRevisionId).toBe(stored.newSnapshotId);
    expect(await db.contractSnapshot.count({ where: { monitorId: monitor.id } })).toBe(2);
  });

  it("keeps a queued job in PostgreSQL across worker shutdown and startup", async () => {
    const monitor = await createReadyMonitor(1, "Worker restart");
    installContract("/openapi.yaml", openApi30Json, "application/json");
    const queued = await enqueueManualCheck(monitor.id, "restart-worker");
    expect((await db.checkRun.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("QUEUED");

    await stopMonitorWorker();
    await startMonitorWorker((runId) => processMonitorCheckRun(runId, { fetchContract: fetcher }));
    const completed = await waitForRun(queued.id, "SUCCESS");
    expect(completed.outcome).toBe("BASELINE_SAVED");
    expect(await db.contractSnapshot.count({ where: { monitorId: monitor.id } })).toBe(1);
    await stopMonitorWorker();
  }, 90_000);

  it("enforces the trusted beta monitor cap when two concurrent creates race", async () => {
    const { workspace, cookie } = await createAccount(2);
    await db.monitor.createMany({
      data: [
        { workspaceId: workspace.id, name: "Existing one", contractUrl, repositoryUrl },
        { workspaceId: workspace.id, name: "Existing two", contractUrl, repositoryUrl },
      ],
    });
    const capacityMonitors = await db.monitor.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true },
    });
    capacityMonitors.forEach((monitor) => ownedMonitorIds.add(monitor.id));
    requestContext.cookie = cookie;
    const createInput = (name: string) => createMonitor({ name, contractUrl, repositoryUrl });
    const concurrent = await Promise.allSettled([createInput("Race one"), createInput("Race two")]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = concurrent.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(MonitorCapacityError),
    });
    expect((rejected as PromiseRejectedResult).reason.limit).toBe(3);
    expect(await db.monitor.count({ where: { workspaceId: workspace.id, status: { not: "WITHDRAWN" } } })).toBe(3);
    await expect(createInput("Over the limit")).rejects.toBeInstanceOf(MonitorCapacityError);
    expect(await db.monitor.count({ where: { workspaceId: workspace.id, status: { not: "WITHDRAWN" } } })).toBe(3);
  });

  it("authorizes check reads and requests by the session workspace, ignoring forged plan claims", async () => {
    const monitor = await createReadyMonitor(0, "Protected monitor");
    installContract("/openapi.yaml", openApi30Json, "application/json");
    requestContext.cookie = cookiesByAccount[0];
    const ownRequest = () => postChecks(new Request(`${appUrl}/api/monitors/${monitor.id}/checks`, {
      method: "POST",
      headers: { origin: appUrl, "content-type": "application/json", "idempotency-key": "authorized-check-route" },
      body: JSON.stringify({}),
    }), { params: Promise.resolve({ id: monitor.id }) });
    const accepted = await ownRequest();
    const acceptedBody = await accepted.json() as { run: { id: string; status: string } };
    expect(accepted.status).toBe(202);
    expect(acceptedBody.run.status).toBe("QUEUED");
    const duplicate = await ownRequest();
    const duplicateBody = await duplicate.json() as { run: { id: string } };
    expect(duplicate.status).toBe(202);
    expect(duplicateBody.run.id).toBe(acceptedBody.run.id);
    const ownHistory = await getChecks(new Request(`${appUrl}/api/monitors/${monitor.id}/checks`, {
      headers: { origin: appUrl },
    }), { params: Promise.resolve({ id: monitor.id }) });
    expect(ownHistory.status).toBe(200);
    expect((await ownHistory.json() as { runs: { id: string }[] }).runs.map((run) => run.id)).toContain(acceptedBody.run.id);

    requestContext.cookie = cookiesByAccount[1];

    const forgedRequest = new Request(`${appUrl}/api/monitors/${monitor.id}/checks`, {
      method: "POST",
      headers: { origin: appUrl, "content-type": "application/json", "idempotency-key": "forged-workspace" },
      body: JSON.stringify({ workspaceId: workspaceIds[0], plan: "owner", entitlementState: "PAID" }),
    });
    const deniedPost = await postChecks(forgedRequest, { params: Promise.resolve({ id: monitor.id }) });
    expect(deniedPost.status).toBe(404);

    const deniedRead = await getChecks(new Request(`${appUrl}/api/monitors/${monitor.id}/checks`, {
      headers: { origin: appUrl },
    }), { params: Promise.resolve({ id: monitor.id }) });
    expect(deniedRead.status).toBe(404);
    expect(await db.checkRun.count({ where: { monitorId: monitor.id } })).toBe(1);
  });
});
