import { notFound } from "next/navigation";
import Link from "next/link";
import { MonitorForm } from "@/components/monitor-form";
import { MonitorStatusChip } from "@/components/monitor-status-chip";
import { listMonitors } from "@/lib/monitors";
import styles from "@/components/monitor-form.module.css";
import monitorStyles from "@/components/monitors.module.css";

export default async function EditMonitorPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, monitors] = await Promise.all([params, listMonitors()]);
  const monitor = monitors.find((item) => item.id === id);
  if (!monitor || monitor.status === "WITHDRAWN") notFound();

  return (
    <main className={monitorStyles.monitorPage}>
      <nav className={`${monitorStyles.breadcrumbs} ${styles.formBreadcrumbs}`} aria-label="Breadcrumb">
        <ol>
          <li><Link href="/app">Workspace</Link></li>
          <li><Link href="/app/monitors">Monitors</Link></li>
          <li><Link href={`/app/monitors/${monitor.id}`}>{monitor.name}</Link></li>
          <li aria-current="page">Edit sources</li>
        </ol>
      </nav>
      <header className={monitorStyles.heading}>
        <div className={monitorStyles.headingCopy}>
          <h1>Edit sources</h1>
          <p className={monitorStyles.lede}>Saving checks both sources again. A source error below links to the field that needs attention.</p>
        </div>
        {monitor.status === "READY"
          ? <MonitorStatusChip tone="success" status="READY">Sources ready</MonitorStatusChip>
          : <MonitorStatusChip tone="warning" status="DRAFT">Needs source attention</MonitorStatusChip>}
      </header>
      <section className={`${monitorStyles.panel} ${styles.formPanel}`} aria-label="Edit monitor sources">
        <p className={styles.guidance}>Public OpenAPI 3.0 or 3.1 (JSON or YAML) and a public HTTPS Git repository. Access is read-only.</p>
        <p className={styles.details}>Use direct public HTTPS URLs on port 443 without query strings or fragments. Supported contract documents use OpenAPI 3.0 or 3.1 in JSON or YAML; remote references are not supported.</p>
        <MonitorForm monitor={monitor} />
      </section>
      <Link className={styles.backlink} href={`/app/monitors/${monitor.id}`}>Back to monitor</Link>
    </main>
  );
}
