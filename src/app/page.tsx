import { Link as HeroLink } from "@/components/ui/heroui-client";
import Link from "next/link";
import SourceWorkbench from "@/components/landing/source-workbench";
import styles from "@/components/landing/landing.module.css";
import { BackgroundLetterGlitch } from "@/components/backgrounds/background-letter-glitch";

function ArrowUpRight() {
  return <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M4 12 12 4M5 4h7v7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" /></svg>;
}

function BrandMark() {
  return <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>;
}

export default function HomePage() {
  return (
    <main className={styles.page}>
      <BackgroundLetterGlitch
        className={styles.background}
        glitchColors={["var(--glitch-slate-1)", "var(--glitch-slate-2)", "var(--glitch-slate-3)", "var(--glitch-ice)"]}
        glitchSpeed={80}
        centerVignette
        outerVignette
      />
      <header className={styles.header}>
        <Link className={styles.wordmark} href="/" aria-label="Mendwire home">
          <BrandMark />
          <span>mendwire</span>
        </Link>
        <nav className={styles.nav} aria-label="Main navigation">
          <HeroLink href="#approach" className={styles.navLink}>How it works</HeroLink>
          <HeroLink href="#workspace" className={styles.navLink}>Workspace</HeroLink>
        </nav>
        <div className={styles.headerActions}>
          <Link href="/sign-in" className={styles.signIn}>Sign in</Link>
          <Link href="/sign-up" className={styles.headerButton}>Create workspace <ArrowUpRight /></Link>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroHeading}>
            <div className={styles.heroStatement}>
              <h1 id="hero-title">Keep API sources <span>ready for change.</span></h1>
              <p>Save a public OpenAPI contract and Git repository. Mendwire checks that both sources are reachable and ready.</p>
            </div>
            <div className={styles.heroActions}>
              <Link href="/sign-up" className={styles.primaryButton}>Get started <ArrowUpRight /></Link>
              <HeroLink href="#approach" className={styles.quietAction}>See how it works</HeroLink>
            </div>
          </div>

          <SourceWorkbench />
          <p className={styles.heroCaption}><span>PUBLIC SOURCES</span> OpenAPI 3.0 / 3.1 · JSON / YAML · Git over HTTPS</p>
        </section>

        <section className={styles.approach} id="approach" aria-labelledby="approach-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.sectionPath}>MONITOR SETUP</p>
              <h2 id="approach-title">Start with the sources.<br /><span>Know what is ready.</span></h2>
            </div>
            <p>Mendwire validates the public contract and repository URLs when you save or recheck a monitor. Source readiness sets up a clear next step.</p>
          </div>
          <ol className={styles.processList}>
            <li><span className={styles.processIndex}>A</span><strong>Save the contract</strong><span>OpenAPI 3.0 or 3.1, in JSON or YAML.</span></li>
            <li><span className={styles.processIndex}>B</span><strong>Check the repository</strong><span>Public HTTPS Git source, read-only.</span></li>
            <li><span className={styles.processIndex}>C</span><strong>See source readiness</strong><span>Resolve source issues before the next step.</span></li>
          </ol>
        </section>

        <section className={styles.roadmap} aria-labelledby="roadmap-title">
          <div className={styles.roadmapHeading}>
            <div>
              <div className={styles.roadmapEyebrow}>
                <p className={styles.sectionPath}>PLANNED DIRECTION</p>
                <span className={styles.plannedChip}>PLANNED</span>
              </div>
              <h2 id="roadmap-title">From change to review.</h2>
            </div>
            <p>Illustrative roadmap. These analysis and repair steps are not live capabilities.</p>
          </div>
          <ol className={styles.roadmapList}>
            <li><span>CONTRACT</span><strong>Identify an API change</strong><p>Compare a contract revision.</p></li>
            <li><span>IMPACT</span><strong>Trace affected code</strong><p>Connect the change to consumers.</p></li>
            <li><span>REVIEW</span><strong>Prepare a proposal</strong><p>Keep any repair under human review.</p></li>
          </ol>
        </section>

        <section className={styles.workspace} id="workspace" aria-labelledby="workspace-title">
          <BackgroundLetterGlitch
            className={styles.workspaceBackground}
            glitchColors={["var(--glitch-slate-1)", "var(--glitch-slate-2)", "var(--glitch-slate-3)", "var(--glitch-ice)"]}
            glitchSpeed={80}
            centerVignette
            outerVignette
            opacity={0.18}
          />
          <div>
            <p className={styles.sectionPath}>WORKSPACE</p>
            <h2 id="workspace-title">A clear place for your sources.</h2>
          </div>
          <div className={styles.workspaceDetails}>
            <p>Each account has a private place to create, edit, and manage monitors. Source access stays read-only, with each monitor keeping its own source details.</p>
            <div className={styles.workspaceActions}>
              <Link href="/sign-up" className={styles.workspacePrimaryButton}>Create your workspace <ArrowUpRight /></Link>
              <Link href="/sign-in" className={styles.workspaceSignIn}>Sign in</Link>
            </div>
          </div>
        </section>
      </div>

      <footer className={styles.footer}>
        <Link className={styles.wordmark} href="/" aria-label="Mendwire home"><BrandMark /><span>mendwire</span></Link>
        <span>Start with sources you can verify.</span>
        <Link href="/sign-in" className={styles.footerLink}>Sign in <ArrowUpRight /></Link>
      </footer>
    </main>
  );
}
