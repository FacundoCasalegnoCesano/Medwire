CREATE TYPE "MonitorStatus" AS ENUM ('DRAFT', 'READY', 'WITHDRAWN');

CREATE TABLE "Monitor" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "contractUrl" VARCHAR(2048) NOT NULL,
    "repositoryUrl" VARCHAR(2048) NOT NULL,
    "status" "MonitorStatus" NOT NULL DEFAULT 'DRAFT',
    "contractError" VARCHAR(240),
    "repositoryError" VARCHAR(240),
    "validationAttemptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Monitor_workspaceId_createdAt_idx" ON "Monitor"("workspaceId", "createdAt");

ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
