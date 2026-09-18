/*
  Integrations V1 (Slack Incoming Webhook only -- architecture lock
  validation, locked spec). Purely additive: one new ActivityEntityType
  enum value and two new tables (IntegrationConnection,
  IntegrationDelivery) with their indexes, foreign keys, and two
  hand-written CHECK constraints. No existing table, column, or
  constraint is altered, and no data is backfilled.

  Hand-authored (this environment's `prisma migrate dev` cannot compute a
  diff here -- its shadow-database step fails against the single-instance
  local PGlite Postgres this sandbox uses in place of Docker/system
  Postgres, see test/support/local-postgres.ts's own doc comment), closely
  following the exact CREATE TABLE / CREATE INDEX / AddForeignKey shape
  Prisma itself generates for a structurally identical multi-FK,
  composite-unique-indexed child table (compare
  20261003000000_add_calendar_event_foundation/migration.sql's own
  CalendarEvent table for the multi-FK shape, and
  20261005000000_add_role_permission_overrides/migration.sql's own
  RolePermissionOverride table for the hand-written-CHECK convention this
  migration reuses twice below).

  A NOTE ON WHAT THIS MIGRATION DOES NOT CONTAIN: this repo has a known,
  already-documented false-positive `prisma migrate diff` would propose
  against the CustomStatusDefinition/CustomFieldDefinition-adjacent
  foreign keys (Client_statusDefinitionId_fkey,
  Lead_statusDefinitionId_fkey, Project_statusDefinitionId_fkey, and
  their Custom Field siblings) -- their live, historical constraints are
  deliberately `ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY
  DEFERRED`, which Prisma's schema DSL cannot express and would otherwise
  keep "correcting" back to a plain, immediately-checked RESTRICT (see
  20261005000000_add_role_permission_overrides/migration.sql's own
  identical note, and 20260926090000_add_custom_statuses_foundation's
  original header for the full reasoning). Nothing about Custom
  Statuses/Custom Fields is touched by this migration -- this note exists
  only so a future migration author re-reading this file understands why
  no such churn appears here, exactly as every prior migration in this
  chain already explains for itself.

  TWO NEW INSTANCES OF THE SAME KIND OF DRIFT, CREATED BY THIS MIGRATION:

  1. "IntegrationConnection_status_credential_pairing_check" (the first
     CHECK below) is intentionally migration-only -- Prisma's schema DSL
     has no CHECK-constraint attribute at all, so schema.prisma cannot
     represent this constraint in any form. Because of that, a future
     `prisma migrate dev` / `prisma migrate diff` run may propose a
     migration that DROPS
     "IntegrationConnection_status_credential_pairing_check", since
     nothing in schema.prisma says it should exist. That DROP CONSTRAINT
     is NOT an intended schema change and must be manually stripped from
     any generated migration, the same discipline already required above
     for the Custom Status/Custom Field FK drift and for
     RolePermissionOverride_role_not_owner_check -- unless the
     Integrations architecture is deliberately changed to no longer
     require this constraint. This constraint is security-relevant, not
     cosmetic: it is the sole database-level guarantee that a
     DISCONNECTED connection can never still carry a live credential, and
     that a CONNECTED/ERROR connection is never missing one (see
     IntegrationConnection's own schema.prisma doc comment and this
     migration's own CHECK comment below for why that invariant matters).

  2. This migration also adds
     "IntegrationDelivery_attempts_nonnegative_check", a much smaller,
     purely defensive CHECK (attempts >= 0) with the exact same DSL gap
     and the exact same future-DROP risk -- listed here for completeness
     so a future migration author scanning this file's own header finds
     every CHECK this migration introduces in one place, not split across
     two separate discoveries.
*/

-- AlterEnum
ALTER TYPE "ActivityEntityType" ADD VALUE 'INTEGRATION_CONNECTION';

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "label" TEXT,
    "encryptedCredential" TEXT,
    "credentialKeyVersion" INTEGER,
    "lastErrorCode" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationDelivery" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "integrationConnectionId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_organizationId_provider_key" ON "IntegrationConnection"("organizationId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationDelivery_integrationConnectionId_activityId_ev_key" ON "IntegrationDelivery"("integrationConnectionId", "activityId", "eventKey");

-- CreateIndex
CREATE INDEX "IntegrationDelivery_status_nextAttemptAt_idx" ON "IntegrationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "IntegrationDelivery_status_lockedAt_idx" ON "IntegrationDelivery"("status", "lockedAt");

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationDelivery" ADD CONSTRAINT "IntegrationDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationDelivery" ADD CONSTRAINT "IntegrationDelivery_integrationConnectionId_fkey" FOREIGN KEY ("integrationConnectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationDelivery" ADD CONSTRAINT "IntegrationDelivery_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK: DISCONNECTED must always mean no live credential; CONNECTED/
-- ERROR must always mean a credential is present. This CHECK was added
-- for the credential-pairing invariant specifically (locked spec §3:
-- "prefer NOT adding extra CHECK complexity unless clearly useful" --
-- no separate status-enum CHECK was deliberately authored; application
-- code, not a dedicated constraint, is what's meant to validate status
-- is one of CONNECTED/DISCONNECTED/ERROR) -- that is the one an
-- app-code-only bug could silently violate with real security
-- consequence (a DISCONNECTED row that still carries a decryptable
-- secret). As an unavoidable side effect of its own two-branch shape,
-- this CHECK also happens to reject any status value other than those
-- three literals (neither branch's `status = ...`/`status IN (...)`
-- condition can ever match a fourth value) -- a stricter, incidental
-- guarantee, not something to rely on as this CHECK's actual purpose.
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_status_credential_pairing_check" CHECK (
  (status = 'DISCONNECTED' AND "encryptedCredential" IS NULL AND "credentialKeyVersion" IS NULL)
  OR
  (status IN ('CONNECTED', 'ERROR') AND "encryptedCredential" IS NOT NULL AND "credentialKeyVersion" IS NOT NULL)
);

-- CHECK: defense in depth only -- application code never decrements
-- attempts or constructs a row with a negative value; this closes the
-- gap against a future bug doing so silently, mirroring the "the CHECK
-- is defense in depth, not the only guard" reasoning
-- RolePermissionOverride_role_not_owner_check's own comment already
-- documents for an unrelated invariant.
ALTER TABLE "IntegrationDelivery" ADD CONSTRAINT "IntegrationDelivery_attempts_nonnegative_check" CHECK ("attempts" >= 0);
