import "server-only";
import nodemailer from "nodemailer";

type TestResetEmail = { to: string; resetUrl: string };
const testResetEmails: TestResetEmail[] = [];

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  if (process.env.NODE_ENV === "test") {
    testResetEmails.push({ to, resetUrl });
    return;
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);
  const from = process.env.SMTP_FROM;
  const username = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const secureValue = process.env.SMTP_SECURE;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !from) {
    throw new Error("SMTP is not configured");
  }
  if (Boolean(username) !== Boolean(password)) throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together");
  if (secureValue !== undefined && secureValue !== "true" && secureValue !== "false") {
    throw new Error("SMTP_SECURE must be true or false");
  }

  const isLoopback = host === "localhost" || host === "::1" || host === "127.0.0.1" || host.startsWith("127.");
  const secure = secureValue === "true" || (secureValue === undefined && port === 465);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !isLoopback && !secure,
    ...(username && password ? { auth: { user: username, pass: password } } : {}),
  });
  await transporter.sendMail({
    from,
    to,
    subject: "Reset your Mendwire password",
    text: `Use this link to choose a new password. It expires in one hour and can only be used once:\n\n${resetUrl}\n\nIf you did not request this change, you can ignore this message.`,
  });
}

export function takeTestResetEmails() {
  if (process.env.NODE_ENV !== "test") throw new Error("Test email capture is only available in test mode");
  return testResetEmails.splice(0);
}
