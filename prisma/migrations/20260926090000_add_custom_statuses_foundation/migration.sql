/*
  Custom Statuses Phase 1 — schema/domain foundation only (see
  CustomStatusDefinition's own doc comment in prisma/schema.prisma for
  the full design story, and this repo's own Custom Fields Phase 1
  migration for the closest architectural precedent). No UI, no Server
  Actions, no replacement of the existing ClientStatus/LeadStage/
  ProjectStatus enum-driven screens — this migration only builds the
  compatibility bridge those screens will eventually migrate onto.

  WHAT THIS MIGRATION DOES:
    1. Two new enums (CustomStatusEntityType, CustomStatusColor) and one
       new table (CustomStatusDefinition) — org-owned, one row per
       configurable status.
    2. A partial unique index enforcing "at most one active default
       status definition per organization+entityType" (Section K) — not
       expressible in the Prisma schema DSL, same "raw SQL constraint,
       documented in both schema.prisma and migration.sql" precedent
       ClientContact's own primary-contact index and Custom Fields' own
       typed-value CHECK constraint already established in this repo.
    3. Backfill: for every existing Organization, inserts the complete
       set of built-in ("system") status definitions for CLIENT/LEAD/
       PROJECT, with deterministic keys/labels/positions/colors derived
       directly from this app's own existing enum values and
       STATUS_TONES color map (src/components/ui/status-badge.tsx) —
       Section E's own explicit "do not invent labels" instruction.
    4. Adds a new, NULLABLE `statusDefinitionId` column to Client/Lead/
       Project, with a deferred-RESTRICT-equivalent FK (see deviation (c)
       below for why it isn't literally ON DELETE RESTRICT), and
       backfills EVERY EXISTING row to the system definition matching
       its current legacy enum/stage value (same organization, matching
       key) — this join can never miss a real row: every existing
       Client/Project row in this application already has a non-null
       organizationId in practice (confirmed via a live Production
       read-only preflight before writing this migration: 0 of 11
       Clients, 0 of 14 Projects had a null organizationId;
       Lead.organizationId has never been nullable at the schema level
       at all).

  WHAT THIS MIGRATION DELIBERATELY DOES NOT DO — three separate,
  independently justified deviations from this phase's own preferred
  design, each exercised via that same design's own explicit "STOP and
  explain" allowance rather than forced through:

  (a) Section P asked for the legacy ClientStatus/LeadStage/ProjectStatus
  columns to become NULLABLE (its own "Strategy A"), so a future custom-
  status assignment could leave the legacy column null rather than
  storing a misleading value. That change is NOT made here. The legacy
  columns are read as a non-null enum across a wide, already-audited set
  of call sites this phase's own audit enumerated in full (dashboard KPI/
  breakdown queries using groupBy(["status"]) and literal `status:
  "IN_PROGRESS"` reads, the Portal's own active-project count, every
  list-page filter, every StatusBadge render, every Activity metadata
  snapshot, and the full existing Leads/Clients/Projects test suite).
  Making the column nullable at the schema level would flip the
  TypeScript type of every one of those reads to `T | null` in one
  change — a "large refactor" this phase's own goal explicitly rules out
  ("Do NOT replace status-based screens until the foundation is proven")
  — to purchase a capability nothing in this phase's own scope can even
  reach yet (no UI/Server Action assigns a custom status to an existing
  entity at all). Deferred to the phase that actually builds that
  assignment surface, where the change can be made and tested together
  with the code that first needs it.

  (b) `statusDefinitionId` itself is NULLABLE, not NOT NULL, even though
  Section M preferred NOT NULL "if migration can create/backfill
  definitions first in the same migration safely" — which this migration
  genuinely can, for every EXISTING row. The obstacle isn't the
  migration's own backfill; it's that a live typecheck against this
  exact schema surfaced 60+ pre-existing files (prisma/seed.ts, and
  dozens of test files across the whole test/integration tree) that construct new
  Client/Lead/Project rows directly via `prisma.<model>.create(...)`,
  entirely independent of the three real product Server Actions. A NOT
  NULL column would force every one of those call sites to be edited in
  this same phase for a value none of them has any reason to care about
  yet — precisely the same "wide blast radius, zero capability purchased
  today" shape as deviation (a) above, just discovered empirically rather
  than by static audit. `statusDefinitionId` is instead populated
  wherever it actually matters: fully backfilled for every existing row
  by this migration, and set going forward by createClientAction/
  createLeadAction/createProjectAction/convertLeadToClientAction (see
  those files' own comments) — every test fixture and seed script that
  doesn't care about Custom Statuses simply leaves it null on its own
  synthetic rows, which is harmless, since nothing in this phase reads it
  as authoritative for anything yet.

  (c) Section M's own preferred `ON DELETE RESTRICT` for Client/Lead/
  Project.statusDefinitionId is NOT what this migration actually
  declares at the database level, even though schema.prisma's own
  `onDelete: Restrict` relation attribute (the closest available Prisma
  DSL construct — Prisma has no `deferrable` relation attribute at all)
  still reads as RESTRICT. Discovered empirically, by this feature's own
  test suite (test/integration/custom-statuses/migration.test.ts's own
  FK-delete-rules test): PostgreSQL's RESTRICT action is ALWAYS checked
  immediately, never deferrable, regardless of the DEFERRABLE keyword
  (this is a real, easy-to-miss distinction from NO ACTION, which
  behaves identically for a direct, non-cascading delete but — only when
  marked DEFERRABLE — can have its check postponed to end-of-transaction
  instead). That immediacy is exactly what breaks Organization deletion
  test-fixture cleanup once any Client/Lead/Project row has a non-null
  statusDefinitionId: deleting an Organization cascades to BOTH Client
  (via Client.organizationId's own pre-existing CASCADE) AND
  CustomStatusDefinition (via this migration's own new CASCADE, a few
  statements below) independently — two siblings under the same parent,
  with no FK relationship to each other directly — so Postgres's
  cascade-trigger firing order between those two siblings is
  unspecified, and can attempt to delete a still-referenced
  CustomStatusDefinition row before the Client row referencing it has
  itself been removed by its own, unrelated cascade. A plain RESTRICT
  can never tolerate that ordering, no matter which order genuinely
  finishes first, because it insists on checking before either cascade
  is known to be complete.
  The fix applied below is `ON DELETE NO ACTION ... DEFERRABLE INITIALLY
  DEFERRED` instead of `ON DELETE RESTRICT` — functionally identical to
  RESTRICT for the one scenario Section M actually cares about (deleting
  a single CustomStatusDefinition row directly, application-level
  "archive, never hard-delete" convention, Section W) — still rejected,
  since nothing removes the referencing Client/Lead/Project row in that
  transaction — but the check itself is now deferred to end-of-
  transaction for a whole-Organization delete, by which point every
  Client/Lead/Project row that referenced the doomed
  CustomStatusDefinition row has already been removed by its own
  Organization-cascade, so the deferred check finds nothing left to
  object to. Section W's own "Organization deletion cascades
  definitions" requirement is satisfied by this, not undermined by it.

  Until a later phase changes any of these: `statusDefinitionId` is
  the new, backfilled, parallel identity (Section Q: authoritative going
  forward for any code that chooses to read it, once populated); the
  legacy enum/stage column remains fully authoritative for every existing
  business rule, filter, and display in this phase, completely unchanged
  in type, nullability, or values. src/lib/custom-statuses/assignment.ts's
  own domain functions keep both representations synchronized for a
  SYSTEM-backed status (both columns updated together); assigning a
  genuinely CUSTOM status can only ever update statusDefinitionId (the
  legacy column has no way to represent it), which remains a known,
  explicitly documented Phase 1 limitation — inert today, since nothing
  in this phase's own scope ever calls that path against an existing
  entity's legacy-authoritative screens.

  No existing Client/Lead/Project row's own legacy status/stage value is
  ever modified by this migration — only new columns are added and
  populated, and new tables are created. Not applied to Production as
  part of authoring it — verified only against this repository's local,
  ephemeral PGlite-backed test harness, exactly like every other
  migration in this project.

  No explicit BEGIN/COMMIT — `prisma migrate deploy` already wraps every
  migration.sql file's statements in its own transaction (see the
  20260911090000 migration's own doc comment for the original finding).
*/

-- CreateEnum
CREATE TYPE "CustomStatusEntityType" AS ENUM ('CLIENT', 'LEAD', 'PROJECT');

-- CreateEnum
CREATE TYPE "CustomStatusColor" AS ENUM ('NEUTRAL', 'INFO', 'WARNING', 'SUCCESS', 'DANGER', 'MUTED');

-- CreateTable
CREATE TABLE "CustomStatusDefinition" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "entityType" "CustomStatusEntityType" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" "CustomStatusColor",
    "position" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomStatusDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomStatusDefinition_organizationId_entityType_key_key" ON "CustomStatusDefinition"("organizationId", "entityType", "key");

-- CreateIndex
CREATE INDEX "CustomStatusDefinition_organizationId_entityType_idx" ON "CustomStatusDefinition"("organizationId", "entityType");

-- CreateIndex
CREATE INDEX "CustomStatusDefinition_organizationId_entityType_archivedAt_idx" ON "CustomStatusDefinition"("organizationId", "entityType", "archivedAt");

-- CreateIndex
CREATE INDEX "CustomStatusDefinition_organizationId_entityType_position_idx" ON "CustomStatusDefinition"("organizationId", "entityType", "position");

-- AddForeignKey
ALTER TABLE "CustomStatusDefinition" ADD CONSTRAINT "CustomStatusDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Section K — at most one ACTIVE default definition per
-- organization+entityType. Deliberately raw/partial: an ordinary
-- @@unique([organizationId, entityType]) would forbid every legitimate
-- non-default or archived row sharing that pair.
CREATE UNIQUE INDEX "custom_status_definition_one_active_default" ON "CustomStatusDefinition"("organizationId", "entityType") WHERE "isDefault" = true AND "archivedAt" IS NULL;

-- Backfill (Section E/N/O) — one full set of built-in system definitions
-- per existing Organization, for all three entity types. Keys/labels
-- match this app's own existing enum values and canonical UI labels
-- exactly (CLIENT_STATUSES in src/lib/validation/client.ts,
-- PROJECT_STATUSES in src/lib/validation/project.ts, LEAD_STAGES in
-- src/lib/leads/stages.ts) — positions match each array's own existing
-- order, colors match STATUS_TONES in src/components/ui/status-badge.tsx
-- exactly. gen_random_uuid() is available natively on both this
-- project's real Postgres target (Supabase, Postgres 15+) and its local
-- PGlite-backed test harness — no extension needs to be enabled for it.
INSERT INTO "CustomStatusDefinition" (
    "id", "organizationId", "entityType", "key", "label", "color", "position", "isDefault", "isSystem", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), o."id", 'CLIENT', v."key", v."label", v."color"::"CustomStatusColor", v."position", v."isDefault", true, now(), now()
FROM "Organization" o
CROSS JOIN (VALUES
    ('lead',     'Lead',     'NEUTRAL', 0, true),
    ('active',   'Active',   'SUCCESS', 1, false),
    ('inactive', 'Inactive', 'MUTED',   2, false),
    ('archived', 'Archived', 'MUTED',   3, false)
) AS v("key", "label", "color", "position", "isDefault");

INSERT INTO "CustomStatusDefinition" (
    "id", "organizationId", "entityType", "key", "label", "color", "position", "isDefault", "isSystem", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), o."id", 'LEAD', v."key", v."label", v."color"::"CustomStatusColor", v."position", v."isDefault", true, now(), now()
FROM "Organization" o
CROSS JOIN (VALUES
    ('new',       'New',       'NEUTRAL', 0, true),
    ('contacted', 'Contacted', 'INFO',    1, false),
    ('qualified', 'Qualified', 'INFO',    2, false),
    ('proposal',  'Proposal',  'INFO',    3, false),
    ('won',       'Won',       'SUCCESS', 4, false),
    ('lost',      'Lost',      'DANGER',  5, false)
) AS v("key", "label", "color", "position", "isDefault");

INSERT INTO "CustomStatusDefinition" (
    "id", "organizationId", "entityType", "key", "label", "color", "position", "isDefault", "isSystem", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), o."id", 'PROJECT', v."key", v."label", v."color"::"CustomStatusColor", v."position", v."isDefault", true, now(), now()
FROM "Organization" o
CROSS JOIN (VALUES
    ('planning',    'Planning',    'NEUTRAL', 0, true),
    ('in_progress', 'In Progress', 'INFO',    1, false),
    ('on_hold',     'On Hold',     'WARNING', 2, false),
    ('completed',   'Completed',   'SUCCESS', 3, false),
    ('cancelled',   'Cancelled',   'DANGER',  4, false)
) AS v("key", "label", "color", "position", "isDefault");

-- Client.statusDefinitionId — added nullable (see this migration's own
-- header comment for why NOT NULL isn't used), backfilled for every
-- EXISTING row by matching each Client's own current `status` enum value
-- (lowercased -- every existing enum value here already has no
-- underscores that would need any further transformation to become its
-- matching key) against the system definition this migration's own
-- backfill above just created for that exact Client's own organization.
ALTER TABLE "Client" ADD COLUMN "statusDefinitionId" UUID;

UPDATE "Client" c
SET "statusDefinitionId" = d."id"
FROM "CustomStatusDefinition" d
WHERE d."organizationId" = c."organizationId"
  AND d."entityType" = 'CLIENT'
  AND d."isSystem" = true
  AND d."key" = lower(c."status"::text);

-- AddForeignKey — NO ACTION DEFERRABLE INITIALLY DEFERRED, not RESTRICT (see this migration's own header comment, deviation (c), for why).
ALTER TABLE "Client" ADD CONSTRAINT "Client_statusDefinitionId_fkey" FOREIGN KEY ("statusDefinitionId") REFERENCES "CustomStatusDefinition"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- CreateIndex
CREATE INDEX "Client_statusDefinitionId_idx" ON "Client"("statusDefinitionId");

-- Lead.statusDefinitionId — same nullable shape as Client above, matched
-- against `stage` (already lowercases with no underscore transformation
-- needed: NEW/CONTACTED/QUALIFIED/PROPOSAL/WON/LOST ->
-- new/contacted/qualified/proposal/won/lost).
ALTER TABLE "Lead" ADD COLUMN "statusDefinitionId" UUID;

UPDATE "Lead" l
SET "statusDefinitionId" = d."id"
FROM "CustomStatusDefinition" d
WHERE d."organizationId" = l."organizationId"
  AND d."entityType" = 'LEAD'
  AND d."isSystem" = true
  AND d."key" = lower(l."stage"::text);

-- AddForeignKey — NO ACTION DEFERRABLE INITIALLY DEFERRED, not RESTRICT (see this migration's own header comment, deviation (c), for why).
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_statusDefinitionId_fkey" FOREIGN KEY ("statusDefinitionId") REFERENCES "CustomStatusDefinition"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- CreateIndex
CREATE INDEX "Lead_statusDefinitionId_idx" ON "Lead"("statusDefinitionId");

-- Project.statusDefinitionId — same nullable shape again, matched
-- against `status` lowercased (PLANNING/IN_PROGRESS/ON_HOLD/COMPLETED/
-- CANCELLED -> planning/in_progress/on_hold/completed/cancelled --
-- lower() alone already produces the exact matching key, since the enum
-- values themselves already use the same underscore-separated shape a
-- key does).
ALTER TABLE "Project" ADD COLUMN "statusDefinitionId" UUID;

UPDATE "Project" p
SET "statusDefinitionId" = d."id"
FROM "CustomStatusDefinition" d
WHERE d."organizationId" = p."organizationId"
  AND d."entityType" = 'PROJECT'
  AND d."isSystem" = true
  AND d."key" = lower(p."status"::text);

-- AddForeignKey — NO ACTION DEFERRABLE INITIALLY DEFERRED, not RESTRICT (see this migration's own header comment, deviation (c), for why).
ALTER TABLE "Project" ADD CONSTRAINT "Project_statusDefinitionId_fkey" FOREIGN KEY ("statusDefinitionId") REFERENCES "CustomStatusDefinition"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- CreateIndex
CREATE INDEX "Project_statusDefinitionId_idx" ON "Project"("statusDefinitionId");
