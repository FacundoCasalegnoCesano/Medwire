import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { BackgroundLetterGlitch } from "@/components/backgrounds/background-letter-glitch";
import styles from "./auth-page.module.css";

type Mode = "sign-up" | "sign-in" | "forgot-password" | "reset-password";

export function AuthPage({ mode }: { mode: Mode }) {
  return (
    <main className={styles.shell} data-surface="auth">
      <BackgroundLetterGlitch
        className={styles.background}
        glitchColors={["var(--glitch-slate-1)", "var(--glitch-slate-2)", "var(--glitch-slate-3)", "var(--glitch-ice)"]}
        glitchSpeed={80}
        centerVignette
        outerVignette
      />
      <header className={styles.header}>
        <Link className="wordmark" href="/" aria-label="Mendwire home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>mendwire</span></Link>
        <Link className="quiet-link" href="/">Back to home</Link>
      </header>
      <div className={styles.content}>
        <div className={styles.grid}>
          <div className={styles.formRegion}>
            <Suspense fallback={<div className={styles.loading} role="status">Loading form…</div>}><AuthForm mode={mode} /></Suspense>
          </div>
          <aside className={styles.context} aria-label="Mendwire source requirements">
            <h2>Keep source checks close to the work.</h2>
            <p>Save a public OpenAPI contract and repository, then review whether both sources are ready.</p>
            <dl className={styles.contextRules}>
              <div><dt>Contract</dt><dd>OpenAPI 3.0 or 3.1</dd></div>
              <div><dt>Repository</dt><dd>Public Git over HTTPS</dd></div>
              <div><dt>Workspace</dt><dd>Private to your account</dd></div>
            </dl>
          </aside>
        </div>
      </div>
      <footer className={styles.footer}><span>Private workspace access</span><span>© {new Date().getFullYear()} Mendwire</span></footer>
    </main>
  );
}
