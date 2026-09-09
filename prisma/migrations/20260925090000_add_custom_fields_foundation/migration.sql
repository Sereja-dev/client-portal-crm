/*
  Custom Fields Phase 1 — schema/domain foundation only (see
  CustomFieldDefinition/CustomFieldOption/CustomFieldValue's own doc
  comments in prisma/schema.prisma for the full design story). No Staff
  UI, no Portal exposure, no Quote/Invoice integration, no automation/
  formula/API surface — those are all later phases. Three new tables plus
  two new enums, purely additive:

    1. CustomFieldEntityType / CustomFieldType enums.
    2. CustomFieldDefinition — org-owned field definitions for exactly
       CLIENT/LEAD/PROJECT, with a stable per-org+entityType+key identity
       separate from the mutable label.
    3. CustomFieldOption — SELECT-only option list, scoped through its
       parent definitionId (no direct organizationId, same shape as
       InvoiceLineItem/QuoteLineItem's own parent-scoped children).
    4. CustomFieldValue — one row per definitionId+entityId, storing a
       typed value across five nullable columns (textValue/numberValue/
       dateValue/booleanValue/selectedOptionId). entityType is NOT
       repeated here — it lives only on the parent definition — and
       entityId is a bare UUID with no literal foreign key to Client/
       Lead/Project (see that model's own comment for why: Postgres can't
       express "exactly one of three nullable FKs" as a constraint
       either way, and a real FK would force Client/Lead/Project's own
       delete paths to become custom-field-aware at the database level).
       Application-layer ownership validation (assertCustomFieldEntityOwnership
       in src/lib/custom-fields/entity-ownership.ts) substitutes for the
       FK.

  Cross-type safety (schema.prisma's CustomFieldValue comment, Section N
  of the originating task): a raw CHECK constraint below enforces that
  exactly one of the five typed columns is non-null on every row — not
  expressible in the Prisma schema DSL, same "constraint lives only in
  migration.sql" precedent as ClientContact's own partial unique index
  and InvoiceEmailAttempt's "one PENDING attempt per invoice" index. The
  constraint is written against columns, not fieldType, so it only ever
  needs revisiting if a genuinely new typed column is introduced later,
  not each time a new CustomFieldType enum value reuses an existing
  column type.

  This migration adds ONLY new schema objects — no existing table is
  altered, no existing row is touched, and no backfill is performed (all
  three new tables start empty; Section U of the originating task). Not
  applied to Production as part of authoring it — verified only against
  this repository's local, ephemeral PGlite-backed test harness (test/
  support/local-postgres.ts) and a dedicated isolated-PGlite schema-
  migration test, exactly like every other migration in this project.

  No explicit BEGIN/COMMIT — `prisma migrate deploy` already wraps every
  migration.sql file's statements in its own transaction (see the
  20260911090000 migration's own doc comment for the original finding).
*/

-- CreateEnum
CREATE TYPE "CustomFieldEntityType" AS ENUM ('CLIENT', 'LEAD', 'PROJECT');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'CHECKBOX', 'SELECT');

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "entityType" "CustomFieldEntityType" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "CustomFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldOption" (
    "id" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldValue" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "textValue" TEXT,
    "numberValue" DECIMAL(10,2),
    "dateValue" TIMESTAMP(3),
    "booleanValue" BOOLEAN,
    "selectedOptionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_organizationId_entityType_key_key" ON "CustomFieldDefinition"("organizationId", "entityType", "key");

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_organizationId_entityType_idx" ON "CustomFieldDefinition"("organizationId", "entityType");

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_organizationId_entityType_archivedAt_idx" ON "CustomFieldDefinition"("organizationId", "entityType", "archivedAt");

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_organizationId_entityType_position_idx" ON "CustomFieldDefinition"("organizationId", "entityType", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldOption_definitionId_value_key" ON "CustomFieldOption"("definitionId", "value");

-- CreateIndex
CREATE INDEX "CustomFieldOption_definitionId_position_idx" ON "CustomFieldOption"("definitionId", "position");

-- CreateIndex
CREATE INDEX "CustomFieldOption_definitionId_archivedAt_idx" ON "CustomFieldOption"("definitionId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldValue_definitionId_entityId_key" ON "CustomFieldValue"("definitionId", "entityId");

-- CreateIndex
CREATE INDEX "CustomFieldValue_organizationId_entityId_idx" ON "CustomFieldValue"("organizationId", "entityId");

-- CreateIndex
CREATE INDEX "CustomFieldValue_definitionId_idx" ON "CustomFieldValue"("definitionId");

-- AddForeignKey
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldOption" ADD CONSTRAINT "CustomFieldOption_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "CustomFieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "CustomFieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_selectedOptionId_fkey" FOREIGN KEY ("selectedOptionId") REFERENCES "CustomFieldOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cross-type safety (schema.prisma's CustomFieldValue comment, Section N):
-- exactly one of the five typed columns may be populated at a time.
-- "Clearing" a value deletes the row entirely (see
-- clearCustomFieldValue in src/lib/custom-fields/values.ts) rather than
-- ever writing an all-null row, so this is "= 1", not "<= 1" — every row
-- that exists must have exactly one typed value.
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_exactly_one_typed_value" CHECK (
    (
        (CASE WHEN "textValue" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "numberValue" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "dateValue" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "booleanValue" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "selectedOptionId" IS NOT NULL THEN 1 ELSE 0 END)
    ) = 1
);
