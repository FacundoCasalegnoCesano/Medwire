export type ImpactClassification = "CONFIRMED" | "CANDIDATE" | "UNSUPPORTED";

export type ImpactEvidence = {
  id: string;
  classification: ImpactClassification;
  repositoryUrl: string;
  commitSha: string;
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
  client: "fetch" | "axios" | null;
  method: string | null;
  requestPath: string | null;
  contractElement: { method: string; path: string; changeCode: string } | null;
  reason: string | null;
};

export type ImpactCoverage = {
  source: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED";
  filesDiscovered: number;
  filesAnalyzed: number;
  filesSkipped: number;
  reasons: string[];
};

export type ImpactAnalysisSummary = {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILURE";
  commitSha: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  coverage: ImpactCoverage | null;
  counts: { confirmed: number; candidates: number; unsupported: number };
  error: string | null;
};

export type ImpactAnalysisDetail = ImpactAnalysisSummary & { evidence: ImpactEvidence[] };
