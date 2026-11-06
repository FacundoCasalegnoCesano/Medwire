import { AppNavigation } from "@/components/app-navigation";
import styles from "@/components/workspace.module.css";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className={styles.frame} data-surface="workbench"><AppNavigation /><div className={styles.content}>{children}</div></div>;
}
