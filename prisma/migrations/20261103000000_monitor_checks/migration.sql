CREATE TYPE "WorkspaceEntitlementState" AS ENUM ('BETA', 'PAID', 'CANCELING', 'OVERDUE', 'EXPIRED');

ALTER TABLE "Workspace"
  ADD COLUMN "entitlementState" "WorkspaceEntitlementState" NOT NULL DEFAULT 'BETA',
  ADD COLUMN "entitlementUntil" TIMESTAMP(3);

ALTER TABLE "Monitor"
  ADD COLUMN "contractVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "currentRevisionId" TEXT,
  ADD COLUMN "nextCheckAt" TIMESTAMP(3),
  ADD COLUMN "lastSuccessfulCheckAt" TIMESTAMP(3);

CREATE TYPE "CheckRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE');
CREATE TYPE "CheckRunTrigger" AS ENUM ('MANUAL', 'SCHEDULED');
CREATE TYPE "CheckRunOutcome" AS ENUM ('BASELINE_SAVED', 'UNCHANGED', 'NO_CHANGES', 'CHANGES_FOUND');

CREATE TABLE "ContractSnapshot" (
  "id" TEXT NOT NULL,
  "monitorId" TEXT NOT NULL,
  "contractVersion" INTEGER NOT NULL,
  "revisionId" CHAR(64) NOT NULL,
  "contractUrl" VARCHAR(2048) NOT NULL,
  "specVersion" VARCHAR(16) NOT NULL,
  "document" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CheckRun" (
  "id" TEXT NOT NULL,
  "monitorId" TEXT NOT NULL,
  "contractVersion" INTEGER NOT NULL,
  "contractUrl" VARCHAR(2048) NOT NULL,
  "trigger" "CheckRunTrigger" NOT NULL,
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "status" "CheckRunStatus" NOT NULL DEFAULT 'QUEUED',
  "outcome" "CheckRunOutcome",
  "previousRevisionId" CHAR(64),
  "newRevisionId" CHAR(64),
  "previousSnapshotId" TEXT,
  "newSnapshotId" TEXT,
  "findings" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "error" VARCHAR(240),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "claimToken" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CheckRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Monitor_currentRevisionId_key" ON "Monitor"("currentRevisionId");
CREATE INDEX "Monitor_status_nextCheckAt_idx" ON "Monitor"("status", "nextCheckAt");
CREATE UNIQUE INDEX "ContractSnapshot_monitorId_contractVersion_revisionId_key"
  ON "ContractSnapshot"("monitorId", "contractVersion", "revisionId");
CREATE INDEX "ContractSnapshot_monitorId_contractVersion_createdAt_idx"
  ON "ContractSnapshot"("monitorId", "contractVersion", "createdAt");
CREATE UNIQUE INDEX "CheckRun_monitorId_idempotencyKey_key"
  ON "CheckRun"("monitorId", "idempotencyKey");
CREATE INDEX "CheckRun_monitorId_createdAt_idx" ON "CheckRun"("monitorId", "createdAt");
CREATE INDEX "CheckRun_status_queuedAt_idx" ON "CheckRun"("status", "queuedAt");
CREATE UNIQUE INDEX "CheckRun_one_active_per_monitor_idx" ON "CheckRun"("monitorId")
  WHERE "status" IN ('QUEUED'::"CheckRunStatus", 'RUNNING'::"CheckRunStatus");

ALTER TABLE "ContractSnapshot"
  ADD CONSTRAINT "ContractSnapshot_monitorId_fkey" FOREIGN KEY ("monitorId")
  REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Monitor"
  ADD CONSTRAINT "Monitor_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId")
  REFERENCES "ContractSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CheckRun"
  ADD CONSTRAINT "CheckRun_monitorId_fkey" FOREIGN KEY ("monitorId")
  REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CheckRun_previousSnapshotId_fkey" FOREIGN KEY ("previousSnapshotId")
  REFERENCES "ContractSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CheckRun_newSnapshotId_fkey" FOREIGN KEY ("newSnapshotId")
  REFERENCES "ContractSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Monitor" SET "nextCheckAt" = "updatedAt" WHERE "status" = 'READY';
