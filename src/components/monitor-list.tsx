"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@heroui/react";
import { MonitorStatusChip } from "@/components/monitor-status-chip";
import type { CheckRunSummary } from "@/lib/monitor-check-types";
import type { MonitorView } from "@/lib/monitor-types";
import styles from "./workspace.module.css";
import monitorStyles from "./monitors.module.css";

function sourceHost(value: string) {
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}

function monitorStatusLabel(monitor: MonitorView) {
  if (monitor.status === "WITHDRAWN") return "Withdrawn";
  if (monitor.status === "DRAFT") return "Sources need attention";
  if (monitor.monitoringStatus === "QUEUED") return "Check queued";
  if (monitor.monitoringStatus === "RUNNING") return "Check running";
  if (monitor.monitoringStatus === "PAUSED") return monitor.pauseReason === "POLICY_DENIED" ? "Checks paused" : "Monitor withdrawn";
  return monitor.baseline ? "Monitoring" : "Sources ready";
}

function hasBreakingFinding(run: CheckRunSummary | null) {
  return run?.outcome === "CHANGES_FOUND" && run.findings.some((finding) => finding.severity === "BREAKING");
}

export function MonitorList({ initialMonitors, initialNotice = "", showSetupSteps = false, variant = "workspace" }: { initialMonitors: MonitorView[]; initialNotice?: string; showSetupSteps?: boolean; variant?: "workspace" | "monitors" }) {
  const isMonitorsPage = variant === "monitors";
  const [monitors, setMonitors] = useState(initialMonitors);
  const [message, setMessage] = useState(initialNotice);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function changeStatus(id: string, action: "withdraw" | "reactivate") {
    setBusyId(id);
    setMessage(action === "withdraw" ? "Withdrawing monitor…" : "Rechecking sources…");
    try {
      const response = await fetch(`/api/monitors/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Monitor update failed.");
      setMonitors((items) => items.map((item) => item.id === id ? result.monitor : item));
      setMessage(result.monitor.status === "READY" ? "Sources ready." : result.monitor.status === "WITHDRAWN" ? "Monitor withdrawn." : "Saved as a draft. Review the source errors.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Monitor update failed. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (monitors.length === 0) {
    if (isMonitorsPage) {
      return (
        <section className={monitorStyles.emptyState} aria-labelledby="monitor-empty-title">
          <span className={monitorStyles.emptyIndex} aria-hidden="true">01 / SOURCES</span>
          {message && <p className={monitorStyles.feedback} role="status" aria-live="polite">{message}</p>}
          <h2 id="monitor-empty-title">Add the first monitor.</h2>
          <p>Connect a public OpenAPI 3.0 or 3.1 contract and a public Git repository over HTTPS. Mendwire checks both sources first. Once they are ready, run a check to save a baseline for later contract comparisons.</p>
          <Link className={`button ${monitorStyles.createButton}`} href="/app/monitors/new">Create first monitor</Link>
        </section>
      );
    }
    return (
      <section className={`${styles.empty} ${showSetupSteps ? styles.homeEmpty : ""}`} aria-labelledby="monitor-empty-title">
        <h2 id="monitor-empty-title">Add the first monitor.</h2>
        <p>Connect a public OpenAPI 3.0 or 3.1 contract and a public Git repository over HTTPS. Mendwire checks both sources first. After they are ready, request an initial check to save the baseline; that starting point is not a breaking-change finding.</p>
        <Link className="button" href="/app/monitors/new">Create first monitor</Link>
        {showSetupSteps && <ol className={styles.setupSteps}>
          <li className={styles.setupStepActive}><b>01</b> Add sources</li>
          <li><b>02</b> Sources ready</li>
          <li><b>03</b> Baseline saved</li>
        </ol>}
      </section>
    );
  }

  return (
    <div className={isMonitorsPage ? monitorStyles.monitorList : styles.monitorList}>
      <AnimatePresence initial={false} mode="wait">
        <motion.p key={message} className={isMonitorsPage ? monitorStyles.feedback : styles.feedback} role="status" aria-live="polite" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>{message}</motion.p>
      </AnimatePresence>
      <ul className={isMonitorsPage ? monitorStyles.monitorItems : styles.monitorItems}>
        {monitors.map((monitor) => (
          isMonitorsPage ? (
            <li className={`${monitorStyles.monitorCard} ${monitor.status === "WITHDRAWN" ? monitorStyles.withdrawn : ""}`} key={monitor.id}>
              <div className={monitorStyles.monitorHead}>
                <div className={monitorStyles.monitorTitle}>
                  <h2>{monitor.name}</h2>
                  {monitor.status === "DRAFT" ? <MonitorStatusChip tone="warning" status="DRAFT">Needs source attention</MonitorStatusChip> : monitor.status === "WITHDRAWN" ? <MonitorStatusChip tone="muted" status="WITHDRAWN">Withdrawn</MonitorStatusChip> : <MonitorStatusChip tone="success" status="READY">Sources ready</MonitorStatusChip>}
                  {monitor.status === "READY" && monitor.monitoringStatus === "QUEUED" && <MonitorStatusChip tone="accent" status="QUEUED">Check queued</MonitorStatusChip>}
                  {monitor.status === "READY" && monitor.monitoringStatus === "RUNNING" && <MonitorStatusChip tone="accent" status="RUNNING">Check running</MonitorStatusChip>}
                  {monitor.status === "READY" && monitor.monitoringStatus === "PAUSED" && monitor.pauseReason === "POLICY_DENIED" && <MonitorStatusChip tone="muted" status="PAUSED">Checks paused</MonitorStatusChip>}
                  {monitor.status === "READY" && hasBreakingFinding(monitor.lastRun) && <MonitorStatusChip tone="warning" status="BREAKING">Breaking changes found</MonitorStatusChip>}
                </div>
                <span className={monitorStyles.monitorDate}>Added {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(monitor.createdAt))}</span>
              </div>
              <dl className={monitorStyles.sourceGrid}>
                <div className={monitorStyles.source}>
                  <dt>OpenAPI</dt>
                  <dd title={monitor.contractUrl || undefined} aria-describedby={monitor.contractError ? `monitor-${monitor.id}-contract-error` : undefined}>{sourceHost(monitor.contractUrl) || "No contract URL saved"}</dd>
                  {monitor.contractError && <Link id={`monitor-${monitor.id}-contract-error`} className={monitorStyles.sourceErrorLink} href={`/app/monitors/${monitor.id}/edit#monitor-contract`}><span aria-hidden="true">!</span> OpenAPI needs attention: {monitor.contractError}</Link>}
                </div>
                <div className={monitorStyles.source}>
                  <dt>Repository</dt>
                  <dd title={monitor.repositoryUrl || undefined} aria-describedby={monitor.repositoryError ? `monitor-${monitor.id}-repository-error` : undefined}>{sourceHost(monitor.repositoryUrl) || "No repository URL saved"}</dd>
                  {monitor.repositoryError && <Link id={`monitor-${monitor.id}-repository-error`} className={monitorStyles.sourceErrorLink} href={`/app/monitors/${monitor.id}/edit#monitor-repository`}><span aria-hidden="true">!</span> Repository needs attention: {monitor.repositoryError}</Link>}
                </div>
              </dl>
              <dl className={monitorStyles.monitorFacts}>
                {monitor.lastSuccessfulCheckAt && <div><dt>Last successful check · UTC</dt><dd>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(monitor.lastSuccessfulCheckAt))}</dd></div>}
                {monitor.nextCheckAt && <div><dt>Next scheduled · UTC</dt><dd>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(monitor.nextCheckAt))}</dd></div>}
              </dl>
              <div className={monitorStyles.monitorActions}>
                {monitor.status !== "WITHDRAWN" ? <><Link className={monitorStyles.actionButton} href={`/app/monitors/${monitor.id}`}>View monitor</Link><Link className={monitorStyles.actionButton} href={`/app/monitors/${monitor.id}/edit`}>Edit sources</Link></> : <Button className={`${monitorStyles.actionButton} ${monitorStyles.reactivateButton}`} type="button" variant="outline" aria-busy={busyId === monitor.id} isDisabled={busyId === monitor.id} onPress={() => changeStatus(monitor.id, "reactivate")}>{busyId === monitor.id ? "Checking…" : "Re-activate and check"}</Button>}
                {monitor.status !== "WITHDRAWN" && <Button className={`${monitorStyles.actionButton} ${monitorStyles.withdrawButton}`} variant="outline" type="button" aria-busy={busyId === monitor.id} isDisabled={busyId === monitor.id} onPress={() => changeStatus(monitor.id, "withdraw")}>{busyId === monitor.id ? "Saving…" : "Withdraw"}</Button>}
              </div>
            </li>
          ) : (
            <li className={styles.monitorCard} key={monitor.id}>
              <div className={styles.monitorHead}>
                <div className={styles.monitorTitle}><h2>{monitor.name}</h2><span className={`${styles.monitorStatus} ${monitor.status === "WITHDRAWN" ? styles.statusWithdrawn : monitor.status === "READY" && monitor.monitoringStatus !== "PAUSED" ? styles.statusReady : styles.statusDraft}`}>{monitorStatusLabel(monitor)}</span></div>
                <span className={styles.monitorDate}>Added {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(monitor.createdAt))}</span>
              </div>
              <dl className={styles.sourceGrid}>
                <div className={styles.source}><dt>OpenAPI</dt><dd>{monitor.contractUrl || "No contract URL saved"}</dd>{monitor.contractError && <Link className={styles.sourceErrorLink} href={`/app/monitors/${monitor.id}/edit#monitor-contract`}>OpenAPI needs attention: {monitor.contractError}</Link>}</div>
                <div className={styles.source}><dt>Repository</dt><dd>{monitor.repositoryUrl || "No repository URL saved"}</dd>{monitor.repositoryError && <Link className={styles.sourceErrorLink} href={`/app/monitors/${monitor.id}/edit#monitor-repository`}>Repository needs attention: {monitor.repositoryError}</Link>}</div>
              </dl>
              <div className={styles.monitorActions}>
                {monitor.status !== "WITHDRAWN" ? <><Link className="button button-small button-outline" href={`/app/monitors/${monitor.id}`}>View monitor</Link><Link className={styles.actionLink} href={`/app/monitors/${monitor.id}/edit`}>Edit sources</Link></> : <Button className={styles.actionButton} type="button" variant="outline" aria-busy={busyId === monitor.id} isDisabled={busyId === monitor.id} onPress={() => changeStatus(monitor.id, "reactivate")}>{busyId === monitor.id ? "Checking…" : "Re-activate and check"}</Button>}
                {monitor.status !== "WITHDRAWN" && <Button className={styles.actionButton} variant="ghost" type="button" aria-busy={busyId === monitor.id} isDisabled={busyId === monitor.id} onPress={() => changeStatus(monitor.id, "withdraw")}>{busyId === monitor.id ? "Saving…" : "Withdraw"}</Button>}
              </div>
            </li>
          )
        ))}
      </ul>
    </div>
  );
}
