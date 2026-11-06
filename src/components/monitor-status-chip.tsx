import type { ReactNode } from "react";
import styles from "./monitor-status-chip.module.css";

type MonitorStatusTone = "warning" | "success" | "muted" | "accent" | "danger";

export function MonitorStatusChip({
  children,
  tone,
  status,
}: {
  children: ReactNode;
  tone: MonitorStatusTone;
  status?: string;
}) {
  const mark = tone === "success" ? "●" : tone === "warning" ? "◐" : tone === "muted" ? "○" : tone === "danger" ? "▲" : "◌";

  return (
    <span className={`${styles.chip} ${styles[tone]}`} data-status={status}>
      <span className={styles.mark} aria-hidden="true">{mark}</span>
      {children}
    </span>
  );
}
