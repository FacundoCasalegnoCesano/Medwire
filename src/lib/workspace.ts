import "server-only";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export async function requireWorkspace() {
  const session = await requireSession();
  const name = `${session.user.name}'s workspace`;

  const [workspace] = await db.$transaction([
    db.workspace.upsert({
      where: { ownerId: session.user.id },
      create: { ownerId: session.user.id, name },
      update: {},
    }),
  ]);

  return workspace;
}
