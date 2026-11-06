"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Description, FieldError, Form, Input, Label, TextField } from "@heroui/react";
import { monitorSaveMessage, type MonitorView } from "@/lib/monitor-types";
import styles from "./monitor-form.module.css";

type Field = "name" | "contractUrl" | "repositoryUrl";
type Feedback = { message: string; fields?: Partial<Record<Field, string>>; success?: boolean };

export function MonitorForm({ monitor }: { monitor?: MonitorView }) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const contractRef = useRef<HTMLInputElement>(null);
  const repositoryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    if (feedback?.fields?.name) nameRef.current?.focus();
    else if (feedback?.fields?.contractUrl) contractRef.current?.focus();
    else if (feedback?.fields?.repositoryUrl) repositoryRef.current?.focus();
  }, [feedback]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback({ message: monitor ? "Checking both sources…" : "Saving and checking both sources…" });
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(monitor ? `/api/monitors/${monitor.id}` : "/api/monitors", {
        method: monitor ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          contractUrl: data.get("contractUrl"),
          repositoryUrl: data.get("repositoryUrl"),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        const fields = result.fields as Feedback["fields"] | undefined;
        setFeedback({ message: result.error ?? "The monitor could not be saved. Try again.", fields });
        return;
      }
      const saved = result.monitor as MonitorView;
      setFeedback({
        message: monitorSaveMessage(saved.status),
        fields: { contractUrl: saved.contractError ?? undefined, repositoryUrl: saved.repositoryError ?? undefined },
        success: saved.status === "READY",
      });
      if (saved.status === "WITHDRAWN") {
        router.replace("/app/monitors?notice=withdrawn");
        return;
      }
      if (saved.status === "READY") {
        router.replace(`/app/monitors/${saved.id}`);
        return;
      }
      if (!monitor) {
        router.replace(`/app/monitors/${saved.id}`);
        return;
      }
      router.refresh();
    } catch {
      setFeedback({ message: "The monitor could not be saved. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Form className={styles.form} validationBehavior="aria" onSubmit={submit} aria-busy={busy}>
      <TextField id="monitor-name" name="name" defaultValue={monitor?.name ?? ""} isInvalid={Boolean(feedback?.fields?.name)}>
        <Label>Monitor name</Label>
        <Input ref={nameRef} maxLength={80} autoFocus={!monitor} aria-describedby={feedback?.fields?.name ? "monitor-name-error" : undefined} />
        {feedback?.fields?.name && <FieldError id="monitor-name-error"><span className={styles.errorMark} aria-hidden="true">!</span>{feedback.fields.name}</FieldError>}
      </TextField>

      <TextField id="monitor-contract" name="contractUrl" defaultValue={monitor?.contractUrl ?? ""} isInvalid={Boolean(feedback?.fields?.contractUrl)}>
        <Label>OpenAPI contract URL</Label>
        <Input ref={contractRef} type="url" maxLength={2048} placeholder="https://api.example.com/openapi.json" aria-describedby={`monitor-contract-description${feedback?.fields?.contractUrl ? " monitor-contract-error" : ""}`} />
        <Description id="monitor-contract-description">Public HTTPS URL with an OpenAPI 3.0 or 3.1 document in JSON or YAML.</Description>
        {feedback?.fields?.contractUrl && <FieldError id="monitor-contract-error"><span className={styles.errorMark} aria-hidden="true">!</span>{feedback.fields.contractUrl}</FieldError>}
      </TextField>

      <TextField id="monitor-repository" name="repositoryUrl" defaultValue={monitor?.repositoryUrl ?? ""} isInvalid={Boolean(feedback?.fields?.repositoryUrl)}>
        <Label>Git repository URL</Label>
        <Input ref={repositoryRef} type="url" maxLength={2048} placeholder="https://github.com/acme/service.git" aria-describedby={`monitor-repository-description${feedback?.fields?.repositoryUrl ? " monitor-repository-error" : ""}`} />
        <Description id="monitor-repository-description">Public Git repository over HTTPS. Reading source does not authorize publishing a pull request.</Description>
        {feedback?.fields?.repositoryUrl && <FieldError id="monitor-repository-error"><span className={styles.errorMark} aria-hidden="true">!</span>{feedback.fields.repositoryUrl}</FieldError>}
      </TextField>

      <AnimatePresence initial={false} mode="wait">
        {feedback && <motion.p key={feedback.message} className={`form-feedback${feedback.success ? " success" : feedback.fields ? " error" : ""}`} role="status" aria-live="polite" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>{feedback.message}</motion.p>}
      </AnimatePresence>
      <div className={styles.formActions}>
        <Button type="submit" aria-busy={busy} isDisabled={busy}>{busy ? "Checking sources…" : monitor ? "Save and check sources" : "Create monitor"}</Button>
        <Link className={styles.cancelLink} href="/app/monitors">Cancel</Link>
      </div>
    </Form>
  );
}
