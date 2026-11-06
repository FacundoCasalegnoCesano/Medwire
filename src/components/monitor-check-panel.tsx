"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { MonitorImpactPanel } from "@/components/monitor-impact-panel";
import { MonitorStatusChip } from "@/components/monitor-status-chip";
import type { CheckRunSummary } from "@/lib/monitor-check-types";
import type { MonitorView } from "@/lib/monitor-types";
import styles from "./monitors.module.css";

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const twoDigits = (part: number) => String(part).padStart(2, "0");
  return `${date.getUTCFullYear()}-${twoDigits(date.getUTCMonth() + 1)}-${twoDigits(date.getUTCDate())} ${twoDigits(date.getUTCHours())}:${twoDigits(date.getUTCMinutes())} UTC`;
}

function runStatusLabel(status: CheckRunSummary["status"]) {
  if (status === "QUEUED") return "Queued";
  if (status === "RUNNING") return "Running";
  if (status === "SUCCESS") return "Succeeded";
  return "Failed";
}

function outcomeLabel(run: CheckRunSummary) {
  const { outcome, findings } = run;
  if (outcome === "BASELINE_SAVED") return "Baseline saved";
  if (outcome === "UNCHANGED") return "Contract unchanged";
  if (outcome === "NO_CHANGES") return "No breaking changes";
  if (outcome === "CHANGES_FOUND") {
    if (findings.some((finding) => finding.severity === "BREAKING")) return "Breaking changes found";
    if (findings.some((finding) => finding.severity === "POTENTIAL")) return "Changes need review";
    return "Changes detected";
  }
  return null;
}

function monitorStatusLabel(monitor: MonitorView) {
  if (monitor.status === "DRAFT") return "Needs source attention";
  if (monitor.status === "WITHDRAWN") return "Withdrawn";
  return "Sources ready";
}

function hasBreakingFinding(run: CheckRunSummary | null) {
  return run?.outcome === "CHANGES_FOUND" && run.findings.some((finding) => finding.severity === "BREAKING");
}

function isRunActive(run: CheckRunSummary) {
  return run.status === "QUEUED" || run.status === "RUNNING";
}

function mergeRuns(current: CheckRunSummary[], incoming: CheckRunSummary[]) {
  const byId = new Map(current.map((run) => [run.id, run]));
  for (const run of incoming) byId.set(run.id, run);
  return [...byId.values()].sort((a, b) => Date.parse(b.queuedAt) - Date.parse(a.queuedAt) || b.id.localeCompare(a.id));
}

export function MonitorCheckPanel({ monitor }: { monitor: MonitorView }) {
  const router = useRouter();
  const requestLock = useRef(false);
  const scheduledRefreshAt = useRef<string | null>(null);
  const [runs, setRuns] = useState<CheckRunSummary[]>(monitor.lastRun ? [monitor.lastRun] : []);
  const [hasActiveRuns, setHasActiveRuns] = useState(
    monitor.monitoringStatus === "QUEUED" || monitor.monitoringStatus === "RUNNING" || Boolean(monitor.lastRun && isRunActive(monitor.lastRun)),
  );
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;

    async function refreshHistory() {
      try {
        const response = await fetch(`/api/monitors/${monitor.id}/checks`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Check history could not be loaded.");
        if (!disposed && Array.isArray(result.runs)) {
          const nextRuns = result.runs as CheckRunSummary[];
          setRuns((current) => mergeRuns(current, nextRuns));
          setHistoryCursor(typeof result.nextCursor === "string" ? result.nextCursor : null);
          setHistoryHasMore(Boolean(result.hasMore));
          setHasActiveRuns(nextRuns.some(isRunActive));
          setHistoryUnavailable(false);
        }
      } catch (error) {
        if (!disposed) {
          setHistoryUnavailable(true);
          setMessage(error instanceof Error ? error.message : "Check history could not be loaded.");
        }
      } finally {
        if (!disposed) setLoadingHistory(false);
      }
    }

    void refreshHistory();
    return () => {
      disposed = true;
    };
  }, [monitor.id]);

  useEffect(() => {
    const propHasActiveRun = monitor.monitoringStatus === "QUEUED" || monitor.monitoringStatus === "RUNNING" || Boolean(monitor.lastRun && isRunActive(monitor.lastRun));
    if (!hasActiveRuns && !propHasActiveRun) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function pollActiveRun() {
      if (disposed) return;
      try {
        const response = await fetch(`/api/monitors/${monitor.id}/checks`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Check status could not be refreshed.");
        if (disposed || !Array.isArray(result.runs)) return;
        const nextRuns = result.runs as CheckRunSummary[];
        setRuns((current) => mergeRuns(current, nextRuns));
        const stillActive = nextRuns.some(isRunActive);
        setHasActiveRuns(stillActive);
        if (!stillActive) {
          router.refresh();
          return;
        }
      } catch (error) {
        if (!disposed) setMessage(error instanceof Error ? error.message : "Check status could not be refreshed.");
      }
      if (!disposed) timer = setTimeout(pollActiveRun, 2500);
    }

    timer = setTimeout(pollActiveRun, 1200);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasActiveRuns, monitor.id, monitor.lastRun, monitor.monitoringStatus, router]);

  useEffect(() => {
    const availableAt = monitor.manualCheck.availableAt;
    if (!availableAt || scheduledRefreshAt.current === availableAt) return;
    const availableTime = new Date(availableAt).getTime();
    if (Number.isNaN(availableTime)) return;
    scheduledRefreshAt.current = availableAt;
    const timer = setTimeout(() => router.refresh(), Math.max(0, availableTime - Date.now()) + 150);
    return () => clearTimeout(timer);
  }, [monitor.manualCheck.availableAt, router]);

  async function runManualCheck() {
    if (requestLock.current || !monitor.manualCheck.allowed) return;
    requestLock.current = true;
    setBusy(true);
    setMessage("Requesting a check…");
    try {
      const response = await fetch(`/api/monitors/${monitor.id}/checks`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The check could not be requested.");
      const run = result.run as CheckRunSummary;
      setRuns((current) => mergeRuns(current, [run]));
      setHasActiveRuns(isRunActive(run));
      setMessage("Check requested.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The check could not be requested. Try again.");
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }

  async function loadOlderRuns() {
    if (!historyCursor || loadingOlder) return;
    setLoadingOlder(true);
    setMessage("");
    try {
      const response = await fetch(`/api/monitors/${monitor.id}/checks?cursor=${encodeURIComponent(historyCursor)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Older check history could not be loaded.");
      if (!Array.isArray(result.runs)) throw new Error("Older check history could not be loaded.");
      setRuns((current) => mergeRuns(current, result.runs as CheckRunSummary[]));
      setHistoryCursor(typeof result.nextCursor === "string" ? result.nextCursor : null);
      setHistoryHasMore(Boolean(result.hasMore));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Older check history could not be loaded.");
    } finally {
      setLoadingOlder(false);
    }
  }

  const currentRunActive = hasActiveRuns || monitor.monitoringStatus === "QUEUED" || monitor.monitoringStatus === "RUNNING" || Boolean(monitor.lastRun && isRunActive(monitor.lastRun));
  const displayedRuns = mergeRuns(runs, monitor.lastRun ? [monitor.lastRun] : []);
  const canRequest = monitor.status === "READY" && monitor.manualCheck.allowed && !currentRunActive && !busy;
  const label = monitorStatusLabel(monitor);

  return (
    <>
      <section className={styles.panel} aria-labelledby="monitor-check-status-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="monitor-check-status-title">Source and check status</h2>
            <p className={styles.panelDescription}>A check compares a valid contract revision with the saved baseline.</p>
          </div>
          <div className={styles.statusGroup}>
            {monitor.status === "DRAFT" ? <MonitorStatusChip tone="warning" status="DRAFT">{label}</MonitorStatusChip> : monitor.status === "WITHDRAWN" ? <MonitorStatusChip tone="muted" status="WITHDRAWN">{label}</MonitorStatusChip> : <MonitorStatusChip tone="success" status="READY">{label}</MonitorStatusChip>}
            {monitor.status === "READY" && monitor.monitoringStatus === "QUEUED" && <MonitorStatusChip tone="accent" status="QUEUED">Check queued</MonitorStatusChip>}
            {monitor.status === "READY" && monitor.monitoringStatus === "RUNNING" && <MonitorStatusChip tone="accent" status="RUNNING">Check running</MonitorStatusChip>}
            {monitor.status === "READY" && monitor.monitoringStatus === "PAUSED" && monitor.pauseReason === "POLICY_DENIED" && <MonitorStatusChip tone="muted" status="PAUSED">Checks paused</MonitorStatusChip>}
            {monitor.status === "READY" && hasBreakingFinding(monitor.lastRun) && <MonitorStatusChip tone="warning" status="BREAKING">Breaking changes found</MonitorStatusChip>}
          </div>
        </div>

        {monitor.status === "DRAFT" && (
            <p className={styles.checkNotice} role="status">
            One or more sources need attention. <Link href={`/app/monitors/${monitor.id}/edit#${monitor.contractError ? "monitor-contract" : "monitor-repository"}`}>Review the source fields</Link> before requesting a baseline.
          </p>
        )}
        {monitor.monitoringStatus === "PAUSED" && monitor.pauseReason === "POLICY_DENIED" && (
          <p className={styles.checkNotice} role="status">Checks are paused by the workspace access policy. {monitor.manualCheck.reason ?? "Contact the workspace owner to restore access."}</p>
        )}
        {monitor.monitoringStatus === "PAUSED" && monitor.pauseReason === "WITHDRAWN" && (
          <p className={styles.checkNotice} role="status">This monitor is withdrawn, so scheduled checks will not run.</p>
        )}
        {monitor.monitoringStatus === "READY" && !monitor.baseline && monitor.status === "READY" && (
          <p className={styles.checkNotice}>Sources are ready. Run the first check to save a baseline. The baseline is a starting point, not a breaking-change finding.</p>
        )}
        {monitor.baseline && (
          <dl className={styles.checkFacts}>
            <div><dt>Baseline revision</dt><dd><code>{monitor.baseline.revisionId}</code></dd></div>
            <div><dt>Baseline saved</dt><dd>{formatDate(monitor.baseline.savedAt) ?? "Time unavailable"}</dd></div>
            <div><dt>Last successful check</dt><dd>{formatDate(monitor.lastSuccessfulCheckAt) ?? "No successful check yet"}</dd></div>
            <div><dt>Next scheduled check</dt><dd>{formatDate(monitor.nextCheckAt) ?? "Not scheduled"}</dd></div>
          </dl>
        )}

        <div className={styles.checkActions}>
          <Button type="button" aria-busy={busy || currentRunActive} isDisabled={!canRequest} onPress={runManualCheck}>
            {busy ? "Requesting check…" : currentRunActive ? "Check in progress…" : monitor.baseline ? "Check now" : "Run first check"}
          </Button>
          {!monitor.manualCheck.allowed && monitor.status === "READY" && <p className={styles.checkHint}>{monitor.manualCheck.reason || "A manual check is temporarily unavailable."}</p>}
        </div>
        <p className={styles.feedback} role="status" aria-live="polite">{message}</p>
      </section>

      <section className={styles.panel} aria-labelledby="monitor-check-history-title">
        <div className={styles.panelHeading}>
          <div><h2 id="monitor-check-history-title">Check history</h2><p className={styles.panelDescription}>Each run keeps its recorded status and contract revisions.</p></div>
        </div>
        {loadingHistory && displayedRuns.length === 0 ? <p className={styles.historyEmpty}>Loading check history…</p> : historyUnavailable && displayedRuns.length === 0 ? <p className={styles.historyEmpty} role="status">History is unavailable right now.</p> : displayedRuns.length === 0 ? <p className={styles.historyEmpty}>No checks have run yet.</p> : (
          <ol className={styles.runList}>
            {displayedRuns.map((run) => (
              <li className={styles.runItem} key={run.id}>
                <div className={styles.runHeading}>
                <div className={styles.runTitle}>
                  <h3>{run.outcome ? "Contract check" : "Check run"}</h3>
                  {run.outcome === "BASELINE_SAVED" && <MonitorStatusChip tone="muted" status="BASELINE_SAVED">Baseline saved</MonitorStatusChip>}
                  {run.outcome === "UNCHANGED" && <MonitorStatusChip tone="success" status="UNCHANGED">Contract unchanged</MonitorStatusChip>}
                  {run.outcome === "NO_CHANGES" && <MonitorStatusChip tone="success" status="NO_CHANGES">No breaking changes</MonitorStatusChip>}
                  {run.outcome === "CHANGES_FOUND" && <MonitorStatusChip tone="warning" status="CHANGES_FOUND">{outcomeLabel(run)}</MonitorStatusChip>}
                  <MonitorStatusChip tone={run.status === "FAILURE" ? "danger" : run.status === "SUCCESS" ? "success" : "accent"} status={run.status}>{runStatusLabel(run.status)}</MonitorStatusChip>
                </div>
                  <time className={styles.runTime} dateTime={run.completedAt ?? run.startedAt ?? run.queuedAt}>{formatDate(run.completedAt ?? run.startedAt ?? run.queuedAt) ?? "Time unavailable"}</time>
                </div>
                {run.previousRevisionId && run.newRevisionId && <p className={styles.runRevisions}><span>From</span> <code>{run.previousRevisionId}</code> <span>to</span> <code>{run.newRevisionId}</code></p>}
                {run.error && <p className={styles.runError}>{run.error}</p>}
                {run.outcome === "CHANGES_FOUND" && run.findings.length > 0 && <ul className={styles.findingList}>{run.findings.map((finding) => <li key={`${run.id}:${finding.code}:${finding.location}`}><strong>{finding.severity === "BREAKING" ? "Breaking" : "Potential"}</strong><span>{finding.method && finding.path ? <code>{finding.method} {finding.path}</code> : finding.location}</span><span>{finding.summary}</span></li>)}</ul>}
                {run.status === "SUCCESS" && run.outcome === "CHANGES_FOUND" && run.findings.some((finding) => finding.severity === "BREAKING") && <MonitorImpactPanel monitorId={monitor.id} repositoryUrl={monitor.repositoryUrl} runId={run.id} initialAnalysis={run.impactAnalysis ?? null} />}
              </li>
            ))}
          </ol>
        )}
        {historyHasMore && <Button type="button" aria-busy={loadingOlder} isDisabled={loadingOlder} onPress={loadOlderRuns}>{loadingOlder ? "Loading older runs…" : "Load older runs"}</Button>}
        {historyUnavailable && displayedRuns.length > 0 && <p role="status">Check history could not be refreshed.</p>}
      </section>
    </>
  );
}
