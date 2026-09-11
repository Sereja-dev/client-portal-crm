-- Public Lead Capture Forms, Phase 1 (foundation).
--
-- Note: `prisma migrate dev --create-only`'s raw diff output also included
-- three unrelated DROP/ADD CONSTRAINT pairs for Client/Lead/Project's own
-- pre-existing statusDefinitionId foreign keys (pre-existing drift between
-- migration 20260926090000_add_custom_statuses_foundation, which created
-- them as `NO ACTION ... DEFERRABLE INITIALLY DEFERRED`, and this schema's
-- current `onDelete: Restrict` declaration, which normalizes to a plain
-- RESTRICT with no DEFERRABLE clause). That drift predates this migration
-- and is unrelated to Lead Capture Forms — deliberately stripped out here
-- rather than silently folded into this feature's own migration; see this
-- PR's own report for the full note.

-- CreateTable
CREATE TABLE "LeadCaptureForm" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "successMessage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fieldsConfig" JSONB NOT NULL DEFAULT '{}',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCaptureForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadCaptureForm_publicToken_key" ON "LeadCaptureForm"("publicToken");

-- CreateIndex
CREATE INDEX "LeadCaptureForm_organizationId_idx" ON "LeadCaptureForm"("organizationId");

-- CreateIndex
CREATE INDEX "LeadCaptureForm_organizationId_archivedAt_idx" ON "LeadCaptureForm"("organizationId", "archivedAt");

-- AddForeignKey
ALTER TABLE "LeadCaptureForm" ADD CONSTRAINT "LeadCaptureForm_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
