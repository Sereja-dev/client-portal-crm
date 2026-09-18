/*
  Roles / Permissions V1 (architecture lock validation, locked spec §4/§7).
  Purely additive: one new ActivityEntityType enum value and one new
  RolePermissionOverride table with its unique index, foreign key, and a
  hand-written CHECK constraint. No existing table, column, or constraint
  is altered, and no data is backfilled.

  Hand-authored (this environment's `prisma migrate dev` cannot compute a
  diff here -- its shadow-database step fails against the single-instance
  local PGlite Postgres this sandbox uses in place of Docker/system
  Postgres, see test/support/local-postgres.ts's own doc comment), closely
  following the exact CREATE TABLE / CREATE INDEX / AddForeignKey shape
  Prisma itself generates for an identical single-parent, cascade-deleted,
  unique-composite-indexed table (compare
  20261004000000_add_industry_preset_foundation/migration.sql's own
  PresetApplication table).

  The role <> 'OWNER' CHECK below is NOT something Prisma's schema DSL can
  express (it has no CHECK-constraint attribute at all) -- it exists only
  in this hand-written SQL, matching prisma/schema.prisma's own
  RolePermissionOverride doc comment, which documents the invariant for
  readability but explicitly defers its actual enforcement to here.

  A NOTE ON WHAT THIS MIGRATION DOES NOT CONTAIN: this repo has a known,
  already-documented false-positive `prisma migrate diff` would propose
  against the CustomStatusDefinition/CustomFieldDefinition-adjacent
  foreign keys (Client_statusDefinitionId_fkey,
  Lead_statusDefinitionId_fkey, Project_statusDefinitionId_fkey, and
  their Custom Field siblings) -- their live, historical constraints are
  deliberately `ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY
  DEFERRED`, which Prisma's schema DSL cannot express and would otherwise
  keep "correcting" back to a plain, immediately-checked RESTRICT (see
  20261004000000_add_industry_preset_foundation/migration.sql's own
  identical note, and 20260926090000_add_custom_statuses_foundation's
  original header for the full reasoning). Nothing about Custom
  Statuses/Custom Fields is touched by this migration -- this note exists
  only so a future migration author re-reading this file understands why
  no such churn appears here, exactly as the Industry Presets migration
  already explains for itself.

  A NEW INSTANCE OF THE SAME KIND OF DRIFT, CREATED BY THIS MIGRATION:
  "RolePermissionOverride_role_not_owner_check" (the CHECK below) is
  intentionally migration-only -- Prisma's schema DSL has no
  CHECK-constraint attribute at all, so schema.prisma cannot represent
  this constraint in any form. Because of that, a future `prisma migrate
  dev` / `prisma migrate diff` run may propose a migration that DROPS
  "RolePermissionOverride_role_not_owner_check", since nothing in
  schema.prisma says it should exist. That DROP CONSTRAINT is NOT an
  intended schema change and must be manually stripped from any generated
  migration, the same discipline already required above for the Custom
  Status/Custom Field FK drift -- unless the Roles / Permissions
  architecture is deliberately changed to no longer require this
  constraint. This constraint is security-relevant, not cosmetic: it is
  the sole database-level guarantee that an OWNER override row can never
  exist (see RolePermissionOverride's own schema.prisma doc comment and
  this migration's own CHECK comment below for why that invariant matters).
*/

-- AlterEnum
ALTER TYPE "ActivityEntityType" ADD VALUE 'ROLE_PERMISSION';

-- CreateTable
CREATE TABLE "RolePermissionOverride" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RolePermissionOverride_organizationId_role_permissionKey_key" ON "RolePermissionOverride"("organizationId", "role", "permissionKey");

-- AddForeignKey
ALTER TABLE "RolePermissionOverride" ADD CONSTRAINT "RolePermissionOverride_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK: OWNER's access to every catalog permission is immutable and
-- unconditional (getEffectivePermission never even queries this table for
-- role === OWNER) -- this constraint is defense in depth against an
-- OWNER row ever being written by any future code path, mirroring the
-- reasoning that surfaced from the Team Ownership Invariant Hardening
-- audit (an app-code-only invariant, with no DB backing, was exactly how
-- the leaveOrganizationAction race went undetected -- this table starts
-- with the DB-level guard instead of retrofitting one later).
ALTER TABLE "RolePermissionOverride" ADD CONSTRAINT "RolePermissionOverride_role_not_owner_check" CHECK ("role" <> 'OWNER');
