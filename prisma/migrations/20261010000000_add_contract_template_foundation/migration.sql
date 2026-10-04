-- Contract Templates V1 (Documents Improvement, Slice B). Purely
-- additive: one new table (ContractTemplate), its indexes, and its own
-- foreign keys. No existing table is altered -- generated via `prisma
-- migrate diff` against the fully-migrated schema and hand-trimmed of
-- spurious diff-tool artifacts the same way 20261009000000_add_invoice_
-- template_foundation's own migration already documents: three
-- DropForeignKey/AddForeignKey pairs for Client/Lead/Project's own
-- pre-existing statusDefinitionId foreign keys (byte-identical before
-- and after, untouched by this migration), plus one RenameIndex no-op
-- for IntegrationDelivery's own pre-existing composite unique index (an
-- unrelated Postgres identifier-truncation ordering artifact the diff
-- tool also emitted). All four were deliberately excluded here so this
-- migration only ever does what its own name says.

-- CreateTable
CREATE TABLE "ContractTemplate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "defaultExpiryOffsetDays" INTEGER,
    "internalNotes" TEXT,
    "createdByUserId" UUID NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractTemplate_organizationId_idx" ON "ContractTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "ContractTemplate_organizationId_archivedAt_idx" ON "ContractTemplate"("organizationId", "archivedAt");

-- AddForeignKey
ALTER TABLE "ContractTemplate" ADD CONSTRAINT "ContractTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractTemplate" ADD CONSTRAINT "ContractTemplate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
