-- Time Tracking, Phase 1 (foundation).
--
-- Note: `prisma migrate dev --create-only`'s raw diff output also included
-- three unrelated DROP/ADD CONSTRAINT pairs for Client/Lead/Project's own
-- pre-existing statusDefinitionId foreign keys (the same pre-existing
-- drift already documented and stripped out of migrations
-- 20260927090000_add_lead_capture_forms_foundation and
-- 20260928090000_add_client_requests_foundation's own header comments —
-- between migration 20260926090000_add_custom_statuses_foundation, which
-- created them as `NO ACTION ... DEFERRABLE INITIALLY DEFERRED`, and this
-- schema's current `onDelete: Restrict` declaration, which normalizes to a
-- plain RESTRICT with no DEFERRABLE clause). Unrelated to this feature,
-- deliberately stripped out here again rather than silently re-included —
-- this migration contains only Time Tracking's own additive changes.

-- AlterEnum
ALTER TYPE "ActivityEntityType" ADD VALUE 'TIME_ENTRY';

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID,
    "projectId" UUID,
    "taskId" UUID,
    "workDate" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "description" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeEntry_organizationId_idx" ON "TimeEntry"("organizationId");

-- CreateIndex
CREATE INDEX "TimeEntry_organizationId_userId_idx" ON "TimeEntry"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "TimeEntry_organizationId_projectId_idx" ON "TimeEntry"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "TimeEntry_organizationId_workDate_idx" ON "TimeEntry"("organizationId", "workDate");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
