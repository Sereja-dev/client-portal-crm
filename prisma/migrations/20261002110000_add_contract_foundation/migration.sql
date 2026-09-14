-- Contracts Phase 1 (schema foundation only). Purely additive: one new
-- enum (ContractStatus), one new table (Contract), its indexes, and its
-- own foreign keys, plus one additive enum value (ActivityEntityType.CONTRACT
-- -- confirmed safe: format-activity.ts's own dispatch falls through to a
-- defined FALLBACK for any unhandled entityType, notification-rules.ts's
-- own RULES map has no entry for it, and workflow-automations/triggers.ts's
-- own trigger allowlist has no entry for it either, so this cannot activate
-- any notification or Workflow Automation side effect). No existing table
-- is altered -- generated via `prisma migrate diff` against the fully-
-- migrated schema and hand-trimmed of three spurious DropForeignKey/
-- AddForeignKey pairs the diff tool emitted for Client/Lead/Project's own
-- pre-existing statusDefinitionId foreign keys (the same diff-ordering
-- artifact, unrelated to this migration, already independently proven
-- pre-existing and noise-only during the Quote Templates Phase 1 review --
-- those three constraints are byte-identical before and after, untouched
-- by this migration, and were deliberately excluded here so this migration
-- only ever does what its own name says).

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'TERMINATED');

-- AlterEnum
ALTER TYPE "ActivityEntityType" ADD VALUE 'CONTRACT';

-- CreateTable
CREATE TABLE "Contract" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "projectId" UUID,
    "signatoryContactId" UUID,
    "contractNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "internalNotes" TEXT,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" UUID,
    "acceptedByPortalUserId" UUID,
    "organizationSnapshot" JSONB,
    "clientSnapshot" JSONB,
    "signatorySnapshot" JSONB,
    "terminatedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contract_organizationId_idx" ON "Contract"("organizationId");

-- CreateIndex
CREATE INDEX "Contract_organizationId_status_idx" ON "Contract"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Contract_organizationId_archivedAt_idx" ON "Contract"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "Contract_clientId_idx" ON "Contract"("clientId");

-- CreateIndex
CREATE INDEX "Contract_projectId_idx" ON "Contract"("projectId");

-- CreateIndex
CREATE INDEX "Contract_signatoryContactId_idx" ON "Contract"("signatoryContactId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_organizationId_contractNumber_key" ON "Contract"("organizationId", "contractNumber");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_signatoryContactId_fkey" FOREIGN KEY ("signatoryContactId") REFERENCES "ClientContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_acceptedByPortalUserId_fkey" FOREIGN KEY ("acceptedByPortalUserId") REFERENCES "PortalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
