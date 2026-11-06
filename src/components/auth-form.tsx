"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button, Description, FieldError, Form, Input, Label, TextField } from "@heroui/react";
import { authClient } from "@/lib/auth-client";
import styles from "./auth-page.module.css";

type AuthMode = "sign-up" | "sign-in" | "forgot-password" | "reset-password";

const copy: Record<AuthMode, { title: string; description: string; submit: string }> = {
  "sign-up": { title: "Create your account", description: "Start with a private Mendwire workspace.", submit: "Create account" },
  "sign-in": { title: "Welcome back", description: "Sign in to continue to your workspace.", submit: "Sign in" },
  "forgot-password": { title: "Reset your password", description: "Enter your account email and we’ll send a reset link if an account exists.", submit: "Send reset link" },
  "reset-password": { title: "Choose a new password", description: "Use at least 12 characters for your new password.", submit: "Update password" },
};

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackKind, setFeedbackKind] = useState<"error" | "success">("error");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const view = copy[mode];
  const resetToken = searchParams.get("token");
  const passwordResetDone = mode === "reset-password" && feedbackKind === "success" && feedback.length > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    setBusy(true);
    try {
      if (mode === "sign-up") {
        const result = await authClient.signUp.email({
          name: String(data.get("name") ?? "").trim(), email, password,
          callbackURL: "/app",
        });
        if (result.error) throw new Error("We couldn’t create your account. Check your details and try again.");
        router.push("/app");
        router.refresh();
      } else if (mode === "sign-in") {
        const result = await authClient.signIn.email({ email, password, callbackURL: "/app" });
        if (result.error) throw new Error("We couldn’t sign you in. Check your details and try again.");
        router.push("/app");
        router.refresh();
      } else if (mode === "forgot-password") {
        const result = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
        if (result.error) throw new Error("We couldn’t process that request right now. Please try again.");
        setFeedbackKind("success");
        setFeedback("If an account exists for that email, a password reset link is on its way.");
      } else {
        if (!resetToken) throw new Error("This reset link is incomplete. Request a new one to continue.");
        if (password.length < 12) throw new Error("Use at least 12 characters for your new password.");
        if (password !== confirmPassword) throw new Error("The passwords don’t match.");
        const result = await authClient.resetPassword({ token: resetToken, newPassword: password });
        if (result.error) throw new Error("This reset link may have expired. Request a new one to continue.");
        setFeedbackKind("success");
        setFeedback("Your password has been updated. You can sign in now.");
      }
    } catch (error) {
      setFeedbackKind("error");
      setFeedback(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card}>
      <h1>{view.title}</h1>
      <p className={styles.description}>{view.description}</p>
      {mode === "reset-password" && !resetToken && <p className="form-feedback error" role="status">This reset link is missing. Request a new one to continue.</p>}
      <AnimatePresence initial={false} mode="wait">
        {passwordResetDone && <motion.p key={`${feedbackKind}-${feedback}`} className="form-feedback success" role="status" aria-live="polite" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>{feedback}</motion.p>}
      </AnimatePresence>
      {!(mode === "reset-password" && (!resetToken || passwordResetDone)) && <Form onSubmit={submit} className={styles.form} aria-busy={busy}>
        {mode === "sign-up" && <TextField name="name" isRequired>
          <Label>Name</Label><Input autoComplete="name" maxLength={100} placeholder="Your name" /><FieldError />
        </TextField>}
        {mode !== "reset-password" && <TextField name="email" type="email" isRequired>
          <Label>Email address</Label><Input autoComplete="email" placeholder="you@company.com" /><FieldError />
        </TextField>}
        {(mode === "sign-in" || mode === "sign-up") && <TextField name="password" type="password" isRequired>
          <Label>Password</Label><Input minLength={mode === "sign-up" ? 12 : undefined} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} placeholder={mode === "sign-up" ? "At least 12 characters" : "Your password"} value={password} onChange={event => setPassword(event.target.value)} />{mode === "sign-up" && <Description>Use at least 12 characters.</Description>}<FieldError />
        </TextField>}
        {mode === "reset-password" && <>
          <TextField name="password" type="password" isRequired>
            <Label>New password</Label><Input minLength={12} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /><Description>Use at least 12 characters.</Description><FieldError />
          </TextField>
          <TextField name="confirm-password" type="password" isRequired>
            <Label>Confirm new password</Label><Input minLength={12} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /><FieldError />
          </TextField>
        </>}
        <AnimatePresence initial={false} mode="wait">
          {feedback && !passwordResetDone && <motion.p key={`${feedbackKind}-${feedback}`} className={`form-feedback ${feedbackKind}`} role="status" aria-live="polite" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>{feedback}</motion.p>}
        </AnimatePresence>
        <Button className={styles.submit} type="submit" aria-busy={busy} isDisabled={busy} fullWidth>{busy ? "Please wait…" : view.submit}</Button>
      </Form>}
      <div className={styles.links}>
        {mode === "sign-in" && <><Link href="/forgot-password">Forgot password?</Link><span>New to Mendwire? <Link href="/sign-up">Create an account</Link></span></>}
        {mode === "sign-up" && <span>Already have an account? <Link href="/sign-in">Sign in</Link></span>}
        {mode === "forgot-password" && <Link href="/sign-in">Back to sign in</Link>}
        {mode === "reset-password" && feedbackKind === "success" && <Link href="/sign-in">Go to sign in</Link>}
        {mode === "reset-password" && feedbackKind !== "success" && <Link href="/forgot-password">Request a new reset link</Link>}
      </div>
    </section>
  );
}
