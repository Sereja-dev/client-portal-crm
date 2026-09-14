-- Quote Templates Phase 1 (schema foundation only). Purely additive: two
-- new tables (QuoteTemplate, QuoteTemplateItem), their indexes, and their
-- own foreign keys. No existing table is altered -- generated via
-- `prisma migrate diff` against the fully-migrated schema and hand-
-- trimmed of three spurious DropForeignKey/AddForeignKey pairs the diff
-- tool emitted for Client/Lead/Project's own pre-existing
-- statusDefinitionId foreign keys (a diff-ordering artifact, not a real
-- change -- those three constraints are byte-identical before and after,
-- untouched by this migration, and were deliberately excluded here so
-- this migration only ever does what its own name says).

-- CreateTable
CREATE TABLE "QuoteTemplate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "notes" TEXT,
    "currency" TEXT NOT NULL,
    "discountType" "InvoiceDiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" DECIMAL(10,2),
    "taxRatePercent" DECIMAL(5,2),
    "taxLabel" "InvoiceTaxLabel" NOT NULL DEFAULT 'TAX',
    "validityDays" INTEGER,
    "createdByUserId" UUID NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteTemplateItem" (
    "id" UUID NOT NULL,
    "quoteTemplateId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteTemplate_organizationId_idx" ON "QuoteTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "QuoteTemplate_organizationId_archivedAt_idx" ON "QuoteTemplate"("organizationId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteTemplateItem_quoteTemplateId_position_key" ON "QuoteTemplateItem"("quoteTemplateId", "position");

-- AddForeignKey
ALTER TABLE "QuoteTemplate" ADD CONSTRAINT "QuoteTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteTemplate" ADD CONSTRAINT "QuoteTemplate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteTemplateItem" ADD CONSTRAINT "QuoteTemplateItem_quoteTemplateId_fkey" FOREIGN KEY ("quoteTemplateId") REFERENCES "QuoteTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
