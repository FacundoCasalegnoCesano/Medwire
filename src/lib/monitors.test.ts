import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireWorkspace, monitor, validateMonitorSources, getMonitorSourceInputError, policyEntitlement, checkRun, contractSnapshot, dbMock } = vi.hoisted(() => {
  const requireWorkspace = vi.fn(async () => ({ id: "workspace-a", ownerId: "user-a", name: "Ada's workspace" }));
  const monitor = {
    create: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  };
  const checkRun = { findFirst: vi.fn() };
  const contractSnapshot = { findUnique: vi.fn() };
  const policyEntitlement = {
    effectiveState: "beta",
    capabilities: { runCheck: true },
    limits: { activeMonitors: 3, checkFrequencyHours: 24 },
    manualCheckCooldownSeconds: 300,
  };
  const tx = { monitor, $queryRawUnsafe: vi.fn() };
  const dbMock = {
    monitor,
    checkRun,
    contractSnapshot,
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
  };
  const validateMonitorSources = vi.fn();
  const getMonitorSourceInputError = vi.fn((value: string) => value.includes("@github.com") && value.includes("user:") ? "Remove credentials from this URL." : null);
  return { requireWorkspace, monitor, validateMonitorSources, getMonitorSourceInputError, policyEntitlement, checkRun, contractSnapshot, dbMock };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace", () => ({ requireWorkspace }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/beta-policy", () => ({
  assertWorkspaceCapability: vi.fn(async () => policyEntitlement),
  resolveWorkspaceEntitlement: vi.fn(async () => policyEntitlement),
}));
vi.mock("@/lib/monitor-sources", () => ({ validateMonitorSources, getMonitorSourceInputError }));

import { createMonitor, listMonitors, updateMonitor, withdrawMonitor } from "@/lib/monitors";
import { monitorSaveMessage } from "@/lib/monitor-types";

const input = {
  name: "Public API",
  contractUrl: "https://api.example.test/openapi.json",
  repositoryUrl: "https://github.com/example/service.git",
};

describe("monitor lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateMonitorSources.mockResolvedValue({
      contract: { valid: true, error: null },
      repository: { valid: true, error: null },
    });
    getMonitorSourceInputError.mockImplementation((value) => value.includes("@github.com") && value.includes("user:") ? "Remove credentials from this URL." : null);
    monitor.create.mockResolvedValue({ id: "monitor-a", workspaceId: "workspace-a" });
    monitor.count.mockResolvedValue(0);
    monitor.findMany.mockResolvedValue([]);
    monitor.findFirst.mockResolvedValue({
      id: "monitor-a", workspaceId: "workspace-a", name: "Public API", contractUrl: input.contractUrl,
      repositoryUrl: input.repositoryUrl, contractVersion: 1, currentRevisionId: null, nextCheckAt: null,
      lastSuccessfulCheckAt: null, status: "WITHDRAWN", contractError: null, repositoryError: null,
      createdAt: new Date("2026-11-02T00:00:00Z"), updatedAt: new Date("2026-11-02T00:00:00Z"),
    });
    monitor.updateMany.mockResolvedValue({ count: 1 });
    checkRun.findFirst.mockResolvedValue(null);
    contractSnapshot.findUnique.mockResolvedValue(null);
  });

  it("saves failed source validation as a persistent draft with field errors", async () => {
    validateMonitorSources.mockResolvedValueOnce({
      contract: { valid: false, error: "OpenAPI document could not be read." },
      repository: { valid: true, error: null },
    });

    await createMonitor(input);

    expect(monitor.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workspaceId: "workspace-a",
        status: "DRAFT",
      }),
    }));
    expect(monitor.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "monitor-a", workspaceId: "workspace-a" }),
      data: expect.objectContaining({ status: "DRAFT", contractError: "OpenAPI document could not be read.", repositoryError: null }),
    }));
  });

  it("marks a monitor ready only after both sources validate", async () => {
    await createMonitor(input);

    expect(monitor.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DRAFT", workspaceId: "workspace-a" }),
    }));
    expect(monitor.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "READY", contractError: null, repositoryError: null }),
    }));
  });

  it("rejects embedded credentials before saving a source URL", async () => {
    await expect(createMonitor({ ...input, repositoryUrl: "https://user:password@github.com/example/service.git" }))
      .rejects.toMatchObject({ fields: { repositoryUrl: "Remove credentials from this URL." } });

    expect(monitor.create).not.toHaveBeenCalled();
    expect(validateMonitorSources).not.toHaveBeenCalled();
  });

  it("scopes every query and mutation to the server-derived workspace", async () => {
    await listMonitors();
    monitor.findFirst.mockResolvedValue({
      id: "monitor-a", workspaceId: "workspace-a", name: "Public API", contractUrl: input.contractUrl,
      repositoryUrl: input.repositoryUrl, contractVersion: 1, currentRevisionId: null, nextCheckAt: null,
      lastSuccessfulCheckAt: null, status: "READY", contractError: null, repositoryError: null,
      validationAttemptId: null, createdAt: new Date(), updatedAt: new Date(),
    });
    await updateMonitor("monitor-other", input);
    await withdrawMonitor("monitor-other");

    expect(monitor.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "workspace-a" } }));
    expect(monitor.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "monitor-other", workspaceId: "workspace-a" }),
    }));
  });

  it("does not let a slow validation replace a later withdrawal", async () => {
    const validate = deferred<{
      contract: { valid: boolean; error: string | null };
      repository: { valid: boolean; error: string | null };
    }>();
    validateMonitorSources.mockReturnValueOnce(validate.promise);
    const validationFinished = createMonitor(input);
    await vi.waitFor(() => expect(monitor.create).toHaveBeenCalled());
    const staleAttempt = monitor.create.mock.calls[0]?.[0].data.validationAttemptId as string;
    await withdrawMonitor("monitor-a");
    const retiredAttempt = monitor.updateMany.mock.calls.at(-1)?.[0].data.validationAttemptId as string;
    validate.resolve({ contract: { valid: true, error: null }, repository: { valid: true, error: null } });
    await validationFinished;

    const finishUpdate = monitor.updateMany.mock.calls.at(-1)?.[0];
    expect(retiredAttempt).not.toBe(staleAttempt);
    expect(finishUpdate.where).toEqual(expect.objectContaining({ workspaceId: "workspace-a", validationAttemptId: staleAttempt }));
    expect(finishUpdate.data.status).toBe("READY");
  });

  it("reports a withdrawn monitor explicitly after a concurrent save", () => {
    expect(monitorSaveMessage("WITHDRAWN")).toContain("withdrawn");
    expect(monitorSaveMessage("WITHDRAWN")).toContain("current status");
    expect(monitorSaveMessage("WITHDRAWN")).not.toContain("draft");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
