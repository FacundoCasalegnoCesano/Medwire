import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { db } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";
import { getAppOrigins } from "@/lib/app-origins";

const authUrl = process.env.BETTER_AUTH_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;

if (!authUrl || !authSecret || authSecret.length < 32) {
  throw new Error("BETTER_AUTH_URL and a 32-character BETTER_AUTH_SECRET are required");
}

export const auth = betterAuth({
  appName: "Mendwire",
  baseURL: authUrl,
  secret: authSecret,
  trustedOrigins: getAppOrigins(),
  advanced: { disableOriginCheck: false },
  database: prismaAdapter(db, {
    provider: "postgresql",
    transaction: true,
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    requireEmailVerification: false,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // Better Auth recommends not awaiting this callback to avoid email enumeration timing leaks.
      void sendPasswordResetEmail(user.email, url).catch(() => {
        console.error("Password reset email delivery failed");
      });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: false },
  },
});

export type AuthSession = typeof auth.$Infer.Session;

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}
