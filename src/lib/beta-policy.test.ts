import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { workspace: { findUnique } } }));

import {
  assertWorkspaceCapability,
  PolicyDeniedError,
  resolveAccessPolicy,
  resolveWorkspaceEntitlement,
} from "@/lib/beta-policy";

describe("versioned beta entitlement policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MENDWIRE_OWNER_USER_IDS = "";
    findUnique.mockResolvedValue({
      id: "workspace-a",
      ownerId: "user-a",
      entitlementState: "BETA",
      entitlementUntil: null,
    });
  });

  it("maps beta and paid to bounded capabilities without enabling publishing", async () => {
    const beta = await resolveWorkspaceEntitlement({ workspaceId: "workspace-a", actorUserId: "user-a" });
    expect(beta.planKey).toBe("beta");
    expect(beta.capabilities).toMatchObject({
      viewWorkspace: true,
      manageMonitors: true,
      runCheck: true,
      analyze: true,
      propose: true,
      publish: false,
    });
    expect(beta.limits).toMatchObject({
      activeMonitors: 3,
      checkFrequencyHours: 24,
      analysesPerPeriod: 10,
      proposalsPerPeriod: 5,
      usagePeriod: "calendar-month-utc",
    });
    expect(beta.manualCheckCooldownSeconds).toBe(300);

    findUnique.mockResolvedValueOnce({ id: "workspace-a", ownerId: "user-a", entitlementState: "PAID", entitlementUntil: new Date(Date.now() + 60_000) });
    const paid = await resolveWorkspaceEntitlement({ workspaceId: "workspace-a", actorUserId: "user-a" });
    expect(paid.effectiveState).toBe("paid");
    expect(paid.capabilities.publish).toBe(false);

    findUnique.mockResolvedValueOnce({ id: "workspace-a", ownerId: "user-a", entitlementState: "PAID", entitlementUntil: new Date(Date.now() - 60_000) });
    const expiredPaid = await resolveWorkspaceEntitlement({ workspaceId: "workspace-a", actorUserId: "user-a" });
    expect(expiredPaid.effectiveState).toBe("expired");
    expect(expiredPaid.capabilities.runCheck).toBe(false);
  });

  it("keeps canceling access only through the trusted period end", () => {
    const current = resolveAccessPolicy("CANCELING", new Date("2026-11-04T00:00:00Z"), new Date("2026-11-03T00:00:00Z"));
    const ended = resolveAccessPolicy("CANCELING", new Date("2026-11-02T00:00:00Z"), new Date("2026-11-03T00:00:00Z"));
    expect(current.capabilities.runCheck).toBe(true);
    expect(ended.effectiveState).toBe("expired");
    expect(ended.capabilities.runCheck).toBe(false);
    expect(ended.capabilities.viewWorkspace).toBe(true);
  });

  it("fails closed for overdue and unknown persisted states", () => {
    const overdue = resolveAccessPolicy("OVERDUE", null, new Date("2026-11-03T00:00:00Z"));
    const unknown = resolveAccessPolicy("UNRECOGNIZED", null, new Date("2026-11-03T00:00:00Z"));
    expect(overdue.capabilities).toMatchObject({ viewWorkspace: true, manageMonitors: false, runCheck: false, analyze: false, propose: false, publish: false });
    expect(unknown.effectiveState).toBe("unknown");
    expect(unknown.capabilities.runCheck).toBe(false);
  });

  it("checks ownership from the database and ignores forged client entitlements", async () => {
    await expect(resolveWorkspaceEntitlement({
      workspaceId: "workspace-a",
      actorUserId: "user-other",
      plan: "owner",
      role: "staff",
    } as never)).rejects.toMatchObject({ code: "WORKSPACE_FORBIDDEN" });

    expect(findUnique).toHaveBeenCalledWith({ where: { id: "workspace-a" } });
  });

  it("does not grant owner testing access to another user's workspace", async () => {
    process.env.MENDWIRE_OWNER_USER_IDS = "user-owner";
    findUnique.mockResolvedValueOnce({
      id: "workspace-a",
      ownerId: "customer-a",
      entitlementState: "BETA",
      entitlementUntil: null,
    });

    await expect(resolveWorkspaceEntitlement({ workspaceId: "workspace-a", actorUserId: "user-owner" }))
      .rejects.toMatchObject({ code: "WORKSPACE_FORBIDDEN" });
  });

  it("returns read-only details for an unknown stored state and rejects work", async () => {
    findUnique.mockResolvedValueOnce({ id: "workspace-a", ownerId: "user-a", entitlementState: "UNKNOWN", entitlementUntil: null });
    const entitlement = await resolveWorkspaceEntitlement({ workspaceId: "workspace-a", actorUserId: "user-a" });
    expect(entitlement.capabilities.viewWorkspace).toBe(true);
    expect(entitlement.capabilities.runCheck).toBe(false);

    findUnique.mockResolvedValueOnce({ id: "workspace-a", ownerId: "user-a", entitlementState: "UNKNOWN", entitlementUntil: null });
    await expect(assertWorkspaceCapability({
      workspaceId: "workspace-a",
      actorUserId: "user-a",
      capability: "run-check",
    })).rejects.toMatchObject({ code: "WORKSPACE_STATE_UNKNOWN" });
  });

  it("gives an allowlisted owner only the bounded owner policy on their own workspace", async () => {
    process.env.MENDWIRE_OWNER_USER_IDS = "user-a";
    const entitlement = await resolveWorkspaceEntitlement({ workspaceId: "workspace-a", actorUserId: "user-a" });
    expect(entitlement.planKey).toBe("owner");
    expect(entitlement.limits.activeMonitors).toBe(3);
    expect(entitlement.capabilities.publish).toBe(false);
  });

  it("denies unavailable capabilities through the shared server check", async () => {
    await expect(assertWorkspaceCapability({
      workspaceId: "workspace-a",
      actorUserId: "user-a",
      capability: "publish",
    })).rejects.toBeInstanceOf(PolicyDeniedError);
    await expect(assertWorkspaceCapability({
      workspaceId: "workspace-a",
      actorUserId: "user-a",
      capability: "publish",
    })).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
  });
});
