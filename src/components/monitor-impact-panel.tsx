"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ImpactAnalysisDetail, ImpactAnalysisSummary, ImpactEvidence } from "@/lib/impact-types";
import styles from "./monitors.module.css";

type Props = {
  monitorId: string;
  repositoryUrl: string;
  runId: string;
  initialAnalysis: ImpactAnalysisSummary | null;
};

const labels = {
  CONFIRMED: "Supported usage",
  CANDIDATE: "Candidate for review",
  UNSUPPORTED: "Unsupported usage",
} as const;

function endpoint(monitorId: string, runId: string) {
  return `/api/monitors/${encodeURIComponent(monitorId)}/checks/${encodeURIComponent(runId)}/impact`;
}

function statusLabel(status: ImpactAnalysisSummary["status"]) {
  if (status === "QUEUED") return "Queued";
  if (status === "RUNNING") return "Running";
  if (status === "SUCCESS") return "Complete";
  return "Failed";
}

function githubRepositoryKey(raw: string) {
  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.port || url.username || url.password || url.search || url.hash || parts.length !== 2 || parts.some((part) => !/^[\w.-]+$/.test(part))) return null;
    return `${parts[0].toLowerCase()}/${parts[1].replace(/\.git$/i, "").toLowerCase()}`;
  } catch {
    return null;
  }
}

function evidenceHref(evidence: ImpactEvidence, expectedRepositoryUrl: string) {
  if (!/^[a-f\d]{40}$/i.test(evidence.commitSha) || !Number.isInteger(evidence.startLine) || evidence.startLine < 1) return null;
  const repositoryKey = githubRepositoryKey(evidence.repositoryUrl);
  if (!repositoryKey || repositoryKey !== githubRepositoryKey(expectedRepositoryUrl)) return null;
  let repository: URL;
  try {
    repository = new URL(evidence.repositoryUrl);
  } catch {
    return null;
  }
  const [owner, repo, ...extra] = repository.pathname.split("/").filter(Boolean);
  if (repository.protocol !== "https:" || repository.hostname.toLowerCase() !== "github.com" || repository.port || repository.username || repository.password || repository.search || repository.hash || !owner || !repo || extra.length || !/^[a-z\d_.-]+$/i.test(owner) || !/^[a-z\d_.-]+$/i.test(repo)) return null;
  const parts = evidence.filePath.split("/");
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || part.includes("\\") || /[\u0000-\u001f]/.test(part))) return null;
  const path = parts.map(encodeURIComponent).join("/");
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo.replace(/\.git$/i, ""))}/blob/${evidence.commitSha}/${path}#L${evidence.startLine}`;
}

async function readPayload(response: Response) {
  const value = await response.json().catch(() => null) as { analysis?: ImpactAnalysisDetail | ImpactAnalysisSummary | null; error?: unknown } | null;
  if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : "Impact analysis could not be loaded.");
  return value;
}

function isImpactDetail(value: ImpactAnalysisDetail | ImpactAnalysisSummary | null): value is ImpactAnalysisDetail {
  return value !== null && Array.isArray((value as { evidence?: unknown }).evidence);
}

function EvidenceItem({ evidence, commitSha, repositoryUrl }: { evidence: ImpactEvidence; commitSha: string | null; repositoryUrl: string }) {
  const href = commitSha === evidence.commitSha ? evidenceHref(evidence, repositoryUrl) : null;
  const snippet = evidence.snippet.slice(0, 1200);
  return (
    <li className={styles.impactEvidence}>
      <div className={styles.impactEvidenceHeading}>
        {href ? <a href={href} target="_blank" rel="noopener noreferrer">{evidence.filePath}{evidence.startLine > 0 ? `:${evidence.startLine}` : ""}</a> : <span>{evidence.filePath}{evidence.startLine > 0 ? `:${evidence.startLine}` : ""}</span>}
        <span>{githubRepositoryKey(evidence.repositoryUrl) ?? "Repository unavailable"}</span>
        {evidence.method && evidence.requestPath && <code>{evidence.method} {evidence.requestPath}</code>}
      </div>
      {evidence.contractElement && <p className={styles.impactContract}><span>Contract change</span><code>{evidence.contractElement.method} {evidence.contractElement.path}</code><span>{evidence.contractElement.changeCode}</span></p>}
      {evidence.reason && <p className={styles.impactReason}>{evidence.reason}</p>}
      <pre className={styles.impactSnippet}><code>{snippet}{evidence.snippet.length > snippet.length ? "…" : ""}</code></pre>
    </li>
  );
}

export function MonitorImpactPanel({ monitorId, repositoryUrl, runId, initialAnalysis }: Props) {
  const titleId = useId();
  const idempotencyKey = useRef<string | null>(null);
  const actionLock = useRef(false);
  const [analysisOverride, setAnalysisOverride] = useState<ImpactAnalysisSummary | null>(null);
  const analysis = analysisOverride ?? initialAnalysis;
  const [detail, setDetail] = useState<ImpactAnalysisDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const analysisId = analysis?.id;
  const analysisStatus = analysis?.status;

  useEffect(() => {
    if (!analysisId || !analysisStatus) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const url = endpoint(monitorId, runId);

    async function refresh() {
      try {
        const response = await fetch(url, { cache: "no-store" });
        const payload = await readPayload(response);
        if (disposed) return;
        const result = payload?.analysis ?? null;
        if (!result) {
          if (analysisStatus === "SUCCESS") throw new Error("Impact evidence is not available yet.");
          if (analysisStatus === "QUEUED" || analysisStatus === "RUNNING") timer = setTimeout(refresh, 2500);
          return;
        }
        if (result.status === "SUCCESS" && !isImpactDetail(result)) throw new Error("Impact evidence is not available yet.");
        setAnalysisOverride(result);
        setDetail(isImpactDetail(result) ? result : null);
        setError(null);
        if (result?.status === "QUEUED" || result?.status === "RUNNING") timer = setTimeout(refresh, 2500);
      } catch (cause) {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : "Impact analysis could not be refreshed.");
        if (analysisStatus === "QUEUED" || analysisStatus === "RUNNING") timer = setTimeout(refresh, 2500);
      }
    }

    void refresh();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [analysisId, analysisStatus, monitorId, reloadToken, runId]);

  async function requestAnalysis() {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError(null);
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    try {
      const response = await fetch(endpoint(monitorId, runId), {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({}),
      });
      const payload = await readPayload(response);
      if (!payload?.analysis) throw new Error("The analysis request returned no status.");
      setAnalysisOverride(payload.analysis);
      setDetail(null);
      idempotencyKey.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impact analysis could not be requested. Try again.");
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  const active = analysis?.status === "QUEUED" || analysis?.status === "RUNNING";
  const categories: ImpactEvidence["classification"][] = ["CONFIRMED", "CANDIDATE", "UNSUPPORTED"];

  return (
    <section className={styles.impactPanel} aria-labelledby={titleId}>
      <div className={styles.impactHeading}>
        <div><h4 id={titleId}>Consumer impact</h4><p>Initial coverage: public GitHub JavaScript and TypeScript using fetch or Axios.</p></div>
        {analysis && <span className={`${styles.impactStatus} ${analysis.status === "FAILURE" ? styles.impactFailure : ""}`} aria-live="polite">{statusLabel(analysis.status)}</span>}
      </div>

      {!analysis && <button className={styles.impactAction} type="button" onClick={requestAnalysis} disabled={busy} aria-busy={busy}>{busy ? "Requesting analysis…" : "Analyze impact"}</button>}
      {analysis && <>
        <dl className={styles.impactFacts}>
          <div><dt>Analyzed commit</dt><dd><code>{analysis.commitSha ?? "Pending revision"}</code></dd></div>
          <div><dt>Confirmed</dt><dd>{analysis.counts.confirmed}</dd></div>
          <div><dt>Candidates</dt><dd>{analysis.counts.candidates}</dd></div>
          <div><dt>Unsupported</dt><dd>{analysis.counts.unsupported}</dd></div>
        </dl>

        {analysis.status === "FAILURE" && <div className={styles.impactFailureMessage} role="status"><p>{analysis.error ?? "The analysis failed and can be retried."}</p><button className={styles.impactAction} type="button" onClick={requestAnalysis} disabled={busy} aria-busy={busy}>{busy ? "Retrying…" : "Retry analysis"}</button></div>}
        {active && <p className={styles.impactProgress} role="status" aria-live="polite">{analysis?.status === "QUEUED" ? "Waiting for an analysis worker…" : "Reading the saved repository revision…"}</p>}
        {analysis?.status === "SUCCESS" && analysis.coverage && <div className={styles.impactCoverage}>
          <div className={styles.impactCoverageTop}><strong>{analysis.coverage.filesAnalyzed} of {analysis.coverage.filesDiscovered} files analyzed</strong><span>{analysis.coverage.source === "SUPPORTED" ? "Supported coverage" : analysis.coverage.source === "PARTIAL" ? "Partial coverage" : "Source unsupported"}</span></div>
          {analysis.coverage.filesSkipped > 0 && <p>{analysis.coverage.filesSkipped} files skipped.</p>}
          {analysis.coverage.reasons.length > 0 && <ul>{analysis.coverage.reasons.map((reason, index) => <li key={`${index}:${reason}`}>{reason}</li>)}</ul>}
        </div>}
        {analysis?.status === "SUCCESS" && analysis.counts.confirmed === 0 && <p className={styles.impactNoMatch}>No supported usage found in the analyzed coverage. This result does not guarantee the integration is unaffected.</p>}
        {analysis?.status === "SUCCESS" && detail && <div className={styles.impactCategories}>
          {categories.map((category) => {
            const items = detail.evidence.filter((item) => item.classification === category);
            return <section key={category} aria-label={labels[category]}><h5>{labels[category]} <span>{items.length}</span></h5>{items.length ? <ul>{items.map((item) => <EvidenceItem key={item.id} evidence={item} commitSha={analysis.commitSha} repositoryUrl={repositoryUrl} />)}</ul> : <p>No items recorded.</p>}</section>;
          })}
        </div>}
        {analysis?.status === "SUCCESS" && !detail && !error && <p className={styles.impactProgress} role="status">Loading evidence…</p>}
        {analysis?.status === "SUCCESS" && !detail && error && <div className={styles.impactFailureMessage} role="status"><p>Evidence details could not be loaded.</p><button className={styles.impactAction} type="button" onClick={() => { setError(null); setReloadToken((value) => value + 1); }}>Load evidence again</button></div>}
      </>}
      {error && <p className={styles.impactFeedback} role="alert">{error}</p>}
      <p className={styles.impactFootnote}>Results are limited to the analyzed coverage and commit. No result guarantees that the integration is unaffected.</p>
    </section>
  );
}
