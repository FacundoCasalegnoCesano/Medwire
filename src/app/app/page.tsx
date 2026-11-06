import { requireWorkspace } from "@/lib/workspace";
import { listMonitors } from "@/lib/monitors";
import { MonitorList } from "@/components/monitor-list";
import { NumberTicker } from "@/components/ui/number-ticker";
import Link from "next/link";
import styles from "@/components/workspace.module.css";

export default async function WorkspacePage() {
  await requireWorkspace();
  const monitors = await listMonitors();
  return (
    <main className={`${styles.page} ${styles.workspaceHome}`}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><ol><li aria-current="page">Workspace</li></ol></nav>
      <header className={styles.heading}>
        <div className={styles.headingCopy}><h1>Your workspace</h1><p className={styles.lede}>Manage API monitors and review the current state of their public sources.</p></div>
        {monitors.length > 0 && <Link className={`button button-small ${styles.headingAction}`} href="/app/monitors/new">Add monitor</Link>}
      </header>
      <section className={styles.section} aria-labelledby="workspace-monitors-title">
        <h2 className={styles.sectionTitle} id="workspace-monitors-title">Saved monitors <span><NumberTicker value={monitors.length} /></span></h2>
      <MonitorList initialMonitors={monitors} showSetupSteps />
      </section>
    </main>
  );
}
