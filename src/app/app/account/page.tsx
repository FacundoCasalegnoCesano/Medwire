import { requireSession } from "@/lib/auth";
import { AccountActions } from "@/components/account-actions";
import Link from "next/link";
import styles from "@/components/workspace.module.css";

export default async function AccountPage() {
  const session = await requireSession();
  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><ol><li><Link href="/app">Workspace</Link></li><li aria-current="page">Account</li></ol></nav>
      <header className={styles.heading}><div className={styles.headingCopy}><h1>Account settings</h1><p className={styles.lede}>Manage the sign-in details for your Mendwire account.</p></div></header>
      <section className={styles.panel} aria-labelledby="profile-title">
        <div className={styles.panelHeading}><div><h2 id="profile-title">Personal details</h2></div></div>
        <dl className={styles.accountDetails}><div><dt>Name</dt><dd>{session.user.name || "Name not provided"}</dd></div><div><dt>Email</dt><dd>{session.user.email}</dd></div></dl>
      </section>
      <section className={`${styles.panel} ${styles.accountSession}`} aria-labelledby="session-title">
        <div><h2 id="session-title">Sign out</h2><p>End this session on the current device.</p></div>
        <AccountActions />
      </section>
    </main>
  );
}
