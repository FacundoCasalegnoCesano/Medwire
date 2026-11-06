import "server-only";
import { db } from "@/lib/db";

export const policyVersion = "beta-2026-11-v1" as const;

type WorkspaceEntitlementState = "BETA" | "PAID" | "CANCELING" | "OVERDUE" | "EXPIRED";
export type WorkspaceCapability = "manage-monitors" | "run-check" | "analysis" | "proposal" | "publish";

type CapabilitySet = {
  viewWorkspace: boolean;
  manageMonitors: boolean;
  runCheck: boolean;
  analyze: boolean;
  propose: boolean;
  publish: boolean;
};

type PolicyLimits = {
  activeMonitors: number;
  checkFrequencyHours: number;
  analysesPerPeriod: number;
  proposalsPerPeriod: number;
  usagePeriod: "calendar-month-utc";
};

export type WorkspaceEntitlement = {
  policyVersion: typeof policyVersion;
  planKey: "beta" | "paid" | "owner" | "read-only" | "unknown";
  effectiveState: "beta" | "paid" | "canceling" | "overdue" | "expired" | "owner" | "unknown";
  capabilities: CapabilitySet;
  limits: PolicyLimits;
  manualCheckCooldownSeconds: number;
  operationalBudgets: {
    contractBytes: number;
    repositoryResponseBytes: number;
    sourceFetchTimeoutMs: number;
  };
};

const positiveInteger = (name: string, fallback: number, max: number) => {
  const configured = process.env[name];
  if (configured === undefined || configured.trim() === "") return fallback;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer from 1 to ${max}`);
  }
  return value;
};

const betaLimits: PolicyLimits = {
  activeMonitors: positiveInteger("MENDWIRE_BETA_ACTIVE_MONITORS", 3, 50),
  checkFrequencyHours: positiveInteger("MENDWIRE_BETA_CHECK_FREQUENCY_HOURS", 24, 168),
  analysesPerPeriod: positiveInteger("MENDWIRE_BETA_ANALYSES_PER_MONTH", 10, 1000),
  proposalsPerPeriod: positiveInteger("MENDWIRE_BETA_PROPOSALS_PER_MONTH", 5, 1000),
  usagePeriod: "calendar-month-utc",
};

const capabilities = (overrides: Partial<CapabilitySet> = {}): CapabilitySet => ({
  viewWorkspace: true,
  manageMonitors: true,
  runCheck: true,
  analyze: true,
  propose: true,
  publish: false,
  ...overrides,
});

const operationalBudgets = {
  contractBytes: 1_048_576,
  repositoryResponseBytes: 2_097_152,
  sourceFetchTimeoutMs: 5_000,
} as const;

const activePolicy = (planKey: "beta" | "paid" | "owner", effectiveState: "beta" | "paid" | "canceling" | "owner"): WorkspaceEntitlement => ({
  policyVersion,
  planKey,
  effectiveState,
  capabilities: capabilities(),
  limits: betaLimits,
  manualCheckCooldownSeconds: positiveInteger("MENDWIRE_MANUAL_CHECK_COOLDOWN_SECONDS", 300, 86_400),
  operationalBudgets,
});

const readOnlyPolicy = (effectiveState: "overdue" | "expired" | "unknown"): WorkspaceEntitlement => ({
  policyVersion,
  planKey: effectiveState === "unknown" ? "unknown" : "read-only",
  effectiveState,
  capabilities: capabilities({ manageMonitors: false, runCheck: false, analyze: false, propose: false }),
  limits: betaLimits,
  manualCheckCooldownSeconds: positiveInteger("MENDWIRE_MANUAL_CHECK_COOLDOWN_SECONDS", 300, 86_400),
  operationalBudgets,
});

export function resolveAccessPolicy(state: string | undefined, entitlementUntil: Date | null, now = new Date()): WorkspaceEntitlement {
  switch (state as WorkspaceEntitlementState | undefined) {
    case "BETA":
      return activePolicy("beta", "beta");
    case "PAID":
      // Until commercial terms are approved, paid access uses the same bounded technical caps as beta.
      return entitlementUntil && entitlementUntil.getTime() > now.getTime()
        ? activePolicy("paid", "paid")
        : readOnlyPolicy("expired");
    case "CANCELING":
      return entitlementUntil && entitlementUntil.getTime() > now.getTime()
        ? activePolicy("paid", "canceling")
        : readOnlyPolicy("expired");
    case "OVERDUE":
      return readOnlyPolicy("overdue");
    case "EXPIRED":
      return readOnlyPolicy("expired");
    default:
      return readOnlyPolicy("unknown");
  }
}

export class PolicyDeniedError extends Error {
  constructor(readonly code: "WORKSPACE_FORBIDDEN" | "CAPABILITY_DISABLED" | "WORKSPACE_STATE_UNKNOWN") {
    super(code);
    this.name = "PolicyDeniedError";
  }
}

type TrustedWorkspaceRecord = {
  id: string;
  ownerId: string;
  entitlementState?: string;
  entitlementUntil?: Date | null;
};

function configuredOwnerIds() {
  return new Set((process.env.MENDWIRE_OWNER_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}

export async function resolveWorkspaceEntitlement(input: { workspaceId: string; actorUserId: string }): Promise<WorkspaceEntitlement> {
  const workspace = await db.workspace.findUnique({ where: { id: input.workspaceId } }) as TrustedWorkspaceRecord | null;
  if (!workspace || workspace.ownerId !== input.actorUserId) throw new PolicyDeniedError("WORKSPACE_FORBIDDEN");

  if (configuredOwnerIds().has(input.actorUserId)) return activePolicy("owner", "owner");

  return resolveAccessPolicy(workspace.entitlementState, workspace.entitlementUntil ?? null);
}

const capabilityName: Record<WorkspaceCapability, keyof CapabilitySet> = {
  "manage-monitors": "manageMonitors",
  "run-check": "runCheck",
  analysis: "analyze",
  proposal: "propose",
  publish: "publish",
};

export async function assertWorkspaceCapability(input: {
  workspaceId: string;
  actorUserId: string;
  capability: WorkspaceCapability;
}): Promise<WorkspaceEntitlement> {
  const entitlement = await resolveWorkspaceEntitlement(input);
  if (entitlement.effectiveState === "unknown") throw new PolicyDeniedError("WORKSPACE_STATE_UNKNOWN");
  if (!entitlement.capabilities[capabilityName[input.capability]]) throw new PolicyDeniedError("CAPABILITY_DISABLED");
  return entitlement;
}
