"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { authClient } from "@/lib/auth-client";
import styles from "./workspace.module.css";

export function AccountActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("We couldn’t sign you out. Please try again.");
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setError("We couldn’t sign you out. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.accountActions}><Button type="button" variant="outline" onPress={signOut} isDisabled={busy} aria-busy={busy}>{busy ? "Signing out…" : "Sign out"}</Button>{error && <p className="form-feedback error" role="status">{error}</p>}</div>;
}
