"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import styles from "./workspace.module.css";

const navigation = [
  { href: "/app", label: "Workspace", match: (pathname: string) => pathname === "/app" },
  { href: "/app/monitors", label: "Monitors", match: (pathname: string) => pathname.startsWith("/app/monitors") },
  { href: "/app/account", label: "Account", match: (pathname: string) => pathname.startsWith("/app/account") },
];

export function AppNavigation() {
  const pathname = usePathname();
  const current = pathname === "/app" ? "Workspace" : pathname.startsWith("/app/monitors") ? "Monitors" : "Account";
  return (
    <>
      <header className={styles.topbar}>
        <p>{pathname === "/app" ? <span>Workspace</span> : <><span>Workspace</span><i aria-hidden="true">/</i>{current}</>}</p>
        <Link className={styles.accountLink} href="/app/account">Account <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M5 4h7v7" /></svg></Link>
      </header>
      <aside className={styles.sidebar}>
        <Link className={`wordmark ${styles.wordmark}`} href="/app" aria-label="Mendwire workspace"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>mendwire</span></Link>
        <p className={styles.workspaceLabel}>PRIVATE WORKSPACE</p>
        <nav className={styles.navigation} aria-label="Workspace navigation">
          {navigation.map((item) => {
            const active = item.match(pathname);
            return <Link className={styles.navigationLink} href={item.href} aria-current={active ? "page" : undefined} key={item.href}>
              {active && <motion.div className={styles.activeIndicator} layoutId="underline" id="underline" aria-hidden="true" initial={false} />}
              <span className={styles.navIcon} aria-hidden="true">{item.label === "Workspace" ? <svg viewBox="0 0 20 20"><rect x="3.5" y="3.5" width="5" height="5" rx="1"/><rect x="11.5" y="3.5" width="5" height="5" rx="1"/><rect x="3.5" y="11.5" width="5" height="5" rx="1"/><rect x="11.5" y="11.5" width="5" height="5" rx="1"/></svg> : item.label === "Monitors" ? <svg viewBox="0 0 20 20"><path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h8"/><circle cx="15.5" cy="14.5" r="1"/></svg> : <svg viewBox="0 0 20 20"><circle cx="10" cy="6.5" r="3"/><path d="M4 16.5c.8-2.6 2.8-4 6-4s5.2 1.4 6 4"/></svg>}</span>
              {item.label}
            </Link>;
          })}
        </nav>
        <p className={styles.sidebarNote}>Monitor public source URLs and review their current validation state.</p>
      </aside>
    </>
  );
}
