import Link from "next/link";
import { MonitorList } from "@/components/monitor-list";
import { listMonitors } from "@/lib/monitors";
import monitorStyles from "@/components/monitors.module.css";

export default async function MonitorsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const [{ notice }, monitors] = await Promise.all([searchParams, listMonitors()]);
  const initialNotice = notice === "withdrawn"
    ? "This monitor was withdrawn while sources were being checked. The monitor list shows its current status."
    : "";
  return (
    <main className={monitorStyles.monitorPage}>
      <nav className={monitorStyles.breadcrumbs} aria-label="Breadcrumb"><ol><li><Link href="/app">Workspace</Link></li><li aria-current="page">Monitors</li></ol></nav>
      <header className={monitorStyles.heading}>
        <div className={monitorStyles.headingCopy}><h1>Monitors</h1><p className={monitorStyles.lede}>Saved public API contracts and repositories, with their latest validation status.</p></div>
        <Link className={`button button-small ${monitorStyles.headingAction}`} href="/app/monitors/new">Add monitor</Link>
      </header>
      <MonitorList initialMonitors={monitors} initialNotice={initialNotice} variant="monitors" />
    </main>
  );
}
