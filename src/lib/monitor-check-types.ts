import type { ImpactAnalysisSummary, ImpactCoverage, ImpactEvidence } from "@/lib/impact-types";

export type CheckRunStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILURE";
export type CheckRunOutcome = "BASELINE_SAVED" | "UNCHANGED" | "NO_CHANGES" | "CHANGES_FOUND";

export type CheckFinding = {
  code: string;
  location: string;
  method: string | null;
  path: string | null;
  summary: string;
  severity: "BREAKING" | "POTENTIAL";
};

export type CheckRunSummary = {
  id: string;
  status: CheckRunStatus;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  outcome: CheckRunOutcome | null;
  previousRevisionId: string | null;
  newRevisionId: string | null;
  error: string | null;
  findings: CheckFinding[];
  impactAnalysis?: ImpactAnalysisSummary | null;
};

export type MonitorBaseline = {
  revisionId: string;
  savedAt: string;
};

export type MonitorCheckState = {
  monitoringStatus: "READY" | "QUEUED" | "RUNNING" | "PAUSED";
  pauseReason: "WITHDRAWN" | "POLICY_DENIED" | null;
  manualCheck: { allowed: boolean; reason: string | null; availableAt: string | null };
  baseline: MonitorBaseline | null;
  lastRun: CheckRunSummary | null;
  lastSuccessfulCheckAt: string | null;
  nextCheckAt: string | null;
};

export function summarizeCheckRun(run: {
  id: string;
  status: CheckRunStatus;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  outcome: CheckRunOutcome | null;
  previousRevisionId: string | null;
  newRevisionId: string | null;
  error: string | null;
  findings: unknown;
  impactAnalysis?: ImpactAnalysisSummary | null;
}): CheckRunSummary {
  return {
    id: run.id,
    status: run.status,
    queuedAt: run.queuedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    outcome: run.outcome,
    previousRevisionId: run.previousRevisionId,
    newRevisionId: run.newRevisionId,
    error: run.error,
    findings: Array.isArray(run.findings) ? run.findings as CheckFinding[] : [],
    ...(run.impactAnalysis !== undefined ? { impactAnalysis: run.impactAnalysis } : {}),
  };
}

export function summarizeImpactAnalysis(run: {
  id: string;
  status: ImpactAnalysisSummary["status"];
  commitSha: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  coverage: unknown;
  evidence: unknown;
  error: string | null;
}): ImpactAnalysisSummary {
  const evidence = Array.isArray(run.evidence) ? run.evidence as ImpactEvidence[] : [];
  let coverage: ImpactCoverage | null = null;
  if (run.coverage && typeof run.coverage === "object" && !Array.isArray(run.coverage)) {
    const value = run.coverage as Partial<ImpactCoverage>;
    if (["SUPPORTED", "PARTIAL", "UNSUPPORTED"].includes(value.source ?? "") &&
      Number.isSafeInteger(value.filesDiscovered) && Number.isSafeInteger(value.filesAnalyzed) &&
      Number.isSafeInteger(value.filesSkipped) && Array.isArray(value.reasons)) {
      coverage = {
        source: value.source as ImpactCoverage["source"],
        filesDiscovered: value.filesDiscovered as number,
        filesAnalyzed: value.filesAnalyzed as number,
        filesSkipped: value.filesSkipped as number,
        reasons: value.reasons.filter((reason): reason is string => typeof reason === "string").slice(0, 12),
      };
    }
  }
  return {
    id: run.id,
    status: run.status,
    commitSha: run.commitSha,
    queuedAt: run.queuedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    coverage,
    counts: {
      confirmed: evidence.filter((item) => item?.classification === "CONFIRMED").length,
      candidates: evidence.filter((item) => item?.classification === "CANDIDATE").length,
      unsupported: evidence.filter((item) => item?.classification === "UNSUPPORTED").length,
    },
    error: run.error,
  };
}
