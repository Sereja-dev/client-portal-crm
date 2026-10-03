-- Invoice Templates V1 (Finance Improvement sub-block D). Purely
-- additive: two new tables (InvoiceTemplate, InvoiceTemplateItem), their
-- indexes, and their own foreign keys. No existing table is altered --
-- generated via `prisma migrate diff` against the fully-migrated schema
-- and hand-trimmed of spurious diff-tool artifacts the same way
-- 20261002100000_add_quote_template_foundation's own migration already
-- documents: three DropForeignKey/AddForeignKey pairs for Client/Lead/
-- Project's own pre-existing statusDefinitionId foreign keys (byte-
-- identical before and after, untouched by this migration), plus one
-- RenameIndex no-op for IntegrationDelivery's own pre-existing composite
-- unique index (an unrelated Postgres identifier-truncation ordering
-- artifact the diff tool also emitted). All four were deliberately
-- excluded here so this migration only ever does what its own name says.

-- CreateTable
CREATE TABLE "InvoiceTemplate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "discountType" "InvoiceDiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" DECIMAL(10,2),
    "taxRatePercent" DECIMAL(5,2),
    "taxLabel" "InvoiceTaxLabel" NOT NULL DEFAULT 'TAX',
    "notes" TEXT,
    "internalNotes" TEXT,
    "dueDateOffsetDays" INTEGER,
    "createdByUserId" UUID NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceTemplateItem" (
    "id" UUID NOT NULL,
    "invoiceTemplateId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceTemplate_organizationId_idx" ON "InvoiceTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "InvoiceTemplate_organizationId_archivedAt_idx" ON "InvoiceTemplate"("organizationId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceTemplateItem_invoiceTemplateId_position_key" ON "InvoiceTemplateItem"("invoiceTemplateId", "position");

-- AddForeignKey
ALTER TABLE "InvoiceTemplate" ADD CONSTRAINT "InvoiceTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTemplate" ADD CONSTRAINT "InvoiceTemplate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTemplateItem" ADD CONSTRAINT "InvoiceTemplateItem_invoiceTemplateId_fkey" FOREIGN KEY ("invoiceTemplateId") REFERENCES "InvoiceTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
