CREATE TYPE "ImpactAnalysisStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE');

CREATE TABLE "ImpactAnalysis" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "checkRunId" TEXT NOT NULL,
  "contractVersion" INTEGER NOT NULL,
  "contractUrl" VARCHAR(2048) NOT NULL,
  "repositoryUrl" VARCHAR(2048) NOT NULL,
  "previousSnapshotId" VARCHAR(64) NOT NULL,
  "newSnapshotId" VARCHAR(64) NOT NULL,
  "previousRevisionId" CHAR(64) NOT NULL,
  "newRevisionId" CHAR(64) NOT NULL,
  "commitSha" VARCHAR(64),
  "analyzerVersion" VARCHAR(32) NOT NULL DEFAULT 'impact-ts-v1',
  "status" "ImpactAnalysisStatus" NOT NULL DEFAULT 'QUEUED',
  "evidence" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "coverage" JSONB,
  "error" VARCHAR(240),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "claimToken" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImpactAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImpactAnalysisRequest" (
  "id" TEXT NOT NULL,
  "analysisId" TEXT NOT NULL,
  "idempotencyKey" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImpactAnalysisRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImpactAnalysis_checkRunId_key" ON "ImpactAnalysis"("checkRunId");
CREATE INDEX "ImpactAnalysis_workspaceId_queuedAt_idx" ON "ImpactAnalysis"("workspaceId", "queuedAt");
CREATE INDEX "ImpactAnalysis_status_queuedAt_idx" ON "ImpactAnalysis"("status", "queuedAt");
CREATE UNIQUE INDEX "ImpactAnalysisRequest_analysisId_idempotencyKey_key"
  ON "ImpactAnalysisRequest"("analysisId", "idempotencyKey");

ALTER TABLE "ImpactAnalysis"
  ADD CONSTRAINT "ImpactAnalysis_workspaceId_fkey" FOREIGN KEY ("workspaceId")
  REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ImpactAnalysis_checkRunId_fkey" FOREIGN KEY ("checkRunId")
  REFERENCES "CheckRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImpactAnalysisRequest"
  ADD CONSTRAINT "ImpactAnalysisRequest_analysisId_fkey" FOREIGN KEY ("analysisId")
  REFERENCES "ImpactAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
