/*
  Industry Presets V1 — schema/domain foundation only. Adds the
  `INDUSTRY_PRESET` onboarding step and the `PresetApplication` audit/
  provenance table (see PresetApplication's own doc comment in
  prisma/schema.prisma). Purely additive: no existing column, table, or
  constraint is altered.

  Concurrency-fix revision (never deployed anywhere -- this migration is
  edited in place rather than superseded by a second one): `organizationId`
  is UNIQUE on its own, not part of a composite `(organizationId,
  presetKey)` unique. A composite unique only rejects a duplicate SAME-
  preset row; it can never stop two concurrent transactions from each
  successfully inserting a row for the SAME organization with two
  DIFFERENT presetKey values. A plain unique on `organizationId` alone
  is the actual, database-enforced "at most one PresetApplication per
  organization" invariant this feature requires -- see PresetApplication's
  own schema doc comment and src/lib/industry-presets/apply.ts's own doc
  comment for the full mechanism (that row is inserted FIRST, inside the
  aggregate transaction, as the real concurrency gate).

  A NOTE ON WHAT THIS MIGRATION DOES NOT CONTAIN: `prisma migrate diff`
  against this repo's schema.prisma always also proposes dropping and
  re-adding Client_statusDefinitionId_fkey, Lead_statusDefinitionId_fkey,
  and Project_statusDefinitionId_fkey as plain
  `ON DELETE RESTRICT ON UPDATE CASCADE`. That is a known false-positive
  diff, not a real change, and is intentionally excluded here.

  The live/historical constraints are deliberately
  `ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED`
  (see 20260926090000_add_custom_statuses_foundation's own migration
  header, deviation (c)) — required so Organization deletion's two
  independent sibling cascades (Lead.organizationId CASCADE and
  CustomStatusDefinition.organizationId CASCADE) can complete regardless
  of their unspecified firing order. Prisma's schema DSL has no
  `deferrable` relation attribute, so schema.prisma's own
  `onDelete: Restrict` is only ever the closest available approximation
  — it can never be diffed to a match, and any migration generated from
  this schema will keep proposing this same churn forever. Applying it
  for real would silently downgrade that constraint back to a plain,
  immediately-checked RESTRICT and reintroduce the exact race
  test/integration/custom-statuses/migration.test.ts's own tests 7a-7d
  were written to prove fixed. Nothing about Custom Statuses is touched
  by this migration.
*/

-- AlterEnum
ALTER TYPE "OnboardingStepKey" ADD VALUE 'INDUSTRY_PRESET';

-- CreateTable
CREATE TABLE "PresetApplication" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "presetKey" TEXT NOT NULL,
    "presetVersion" INTEGER NOT NULL,
    "appliedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PresetApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PresetApplication_organizationId_key" ON "PresetApplication"("organizationId");

-- AddForeignKey
ALTER TABLE "PresetApplication" ADD CONSTRAINT "PresetApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresetApplication" ADD CONSTRAINT "PresetApplication_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
