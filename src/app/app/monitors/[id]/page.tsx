import Link from "next/link";
import { notFound } from "next/navigation";
import { MonitorCheckPanel } from "@/components/monitor-check-panel";
import { listMonitors } from "@/lib/monitors";
import styles from "@/components/monitors.module.css";

export default async function MonitorDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, monitors] = await Promise.all([params, listMonitors()]);
  const monitor = monitors.find((item) => item.id === id);
  if (!monitor) notFound();

  return (
    <main className={styles.monitorPage}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
        <ol>
          <li><Link href="/app">Workspace</Link></li>
          <li><Link href="/app/monitors">Monitors</Link></li>
          <li aria-current="page">{monitor.name}</li>
        </ol>
      </nav>
      <header className={styles.heading}>
        <div className={styles.headingCopy}>
          <h1>{monitor.name}</h1>
          <p className={styles.lede}>Review the saved sources, current check state, baseline and recorded history.</p>
        </div>
        {monitor.status !== "WITHDRAWN" && <Link className={`button button-small ${styles.headingAction}`} href={`/app/monitors/${monitor.id}/edit`}>Edit sources</Link>}
      </header>

      <MonitorCheckPanel monitor={monitor} />

      <section className={styles.panel} aria-labelledby="monitor-sources-title">
        <div className={styles.panelHeading}>
          <div><h2 id="monitor-sources-title">Saved sources</h2><p className={styles.panelDescription}>Public sources used for OpenAPI contract checks.</p></div>
          {monitor.status !== "WITHDRAWN" && <Link className={styles.panelAction} href={`/app/monitors/${monitor.id}/edit`}>Edit sources</Link>}
        </div>
        <dl className={styles.sourcePanelGrid}>
          <div className={styles.sourcePanel}>
            <dt>OpenAPI contract</dt>
            <dd aria-describedby={monitor.contractError ? `monitor-${monitor.id}-detail-contract-error` : undefined}>{monitor.contractUrl || "No contract URL saved"}</dd>
            {monitor.contractError && <p id={`monitor-${monitor.id}-detail-contract-error`} className={styles.sourceError}><span aria-hidden="true">!</span> <Link href={`/app/monitors/${monitor.id}/edit#monitor-contract`}>Needs attention: {monitor.contractError}</Link></p>}
          </div>
          <div className={styles.sourcePanel}>
            <dt>Git repository</dt>
            <dd aria-describedby={monitor.repositoryError ? `monitor-${monitor.id}-detail-repository-error` : undefined}>{monitor.repositoryUrl || "No repository URL saved"}</dd>
            {monitor.repositoryError && <p id={`monitor-${monitor.id}-detail-repository-error`} className={styles.sourceError}><span aria-hidden="true">!</span> <Link href={`/app/monitors/${monitor.id}/edit#monitor-repository`}>Needs attention: {monitor.repositoryError}</Link></p>}
          </div>
        </dl>
        {monitor.status === "WITHDRAWN" && <p className={styles.checkNotice}>This monitor is withdrawn. Return to the <Link href="/app/monitors">monitor list</Link> to reactivate it.</p>}
      </section>
      <Link className={styles.backlink} href="/app/monitors">Back to monitors</Link>
    </main>
  );
}
