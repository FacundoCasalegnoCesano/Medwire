import type { MonitorCheckState } from "@/lib/monitor-check-types";

export type MonitorView = {
  id: string;
  name: string;
  contractUrl: string;
  repositoryUrl: string;
  status: "DRAFT" | "READY" | "WITHDRAWN";
  contractError: string | null;
  repositoryError: string | null;
  createdAt: string;
  updatedAt: string;
} & MonitorCheckState;

export function monitorSaveMessage(status: MonitorView["status"]) {
  if (status === "WITHDRAWN") return "This monitor was withdrawn while sources were being checked. The monitor list shows its current status.";
  if (status === "READY") return "Sources ready. Request the first check to save a starting baseline.";
  return "Saved as a draft. Review the source errors below.";
}
