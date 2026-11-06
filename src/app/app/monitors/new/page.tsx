import Link from "next/link";
import { MonitorForm } from "@/components/monitor-form";
import { requireWorkspace } from "@/lib/workspace";
import styles from "@/components/monitor-form.module.css";
import monitorStyles from "@/components/monitors.module.css";

export default async function NewMonitorPage() {
  await requireWorkspace();
  return (
    <main className={monitorStyles.monitorPage}>
      <nav className={`${monitorStyles.breadcrumbs} ${styles.formBreadcrumbs}`} aria-label="Breadcrumb"><ol><li><Link href="/app">Workspace</Link></li><li><Link href="/app/monitors">Monitors</Link></li><li aria-current="page">New monitor</li></ol></nav>
      <header className={monitorStyles.heading}><div className={monitorStyles.headingCopy}><h1>Create a monitor</h1><p className={monitorStyles.lede}>Mendwire checks both URLs and saves a draft if one needs attention.</p></div></header>
      <section className={`${monitorStyles.panel} ${styles.formPanel}`} aria-labelledby="monitor-form-title">
        <div className={monitorStyles.panelHeading}><h2 id="monitor-form-title">Contract and repository</h2></div>
        <p className={styles.guidance}>Public OpenAPI 3.0 or 3.1 (JSON or YAML) and a public HTTPS Git repository. Access is read-only.</p>
        <p className={styles.details}>Use direct public HTTPS URLs on port 443 without query strings or fragments. The contract must contain an OpenAPI 3.0 or 3.1 document in JSON or YAML; remote references are not supported. The repository must allow public Git reads. Reading a repository does not authorize publishing changes.</p>
        <MonitorForm />
      </section>
      <Link className={styles.backlink} href="/app/monitors">Back to monitors</Link>
    </main>
  );
}
