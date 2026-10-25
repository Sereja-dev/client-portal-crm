-- Phone Recovery Foundation, Slice B1 (read-only architecture audit:
-- PHONE_RECOVERY_AUDIT). Purely additive: two new nullable columns, no
-- DEFAULT, no backfill statement needed -- every existing "User" row
-- remains valid with both columns NULL (Postgres' ADD COLUMN for a
-- nullable column with no default is a fast, metadata-only operation,
-- same reasoning 20260917090000_add_platform_admin_organization_
-- suspension/migration.sql's own "suspendedAt TIMESTAMP(3)" addition
-- already documents for an identical shape).
--
-- "phone" is globally unique (never organization-scoped, matching
-- "email" above it) -- see User.phone's own schema.prisma doc comment
-- for the full reasoning. No value is ever written here by this slice;
-- see src/lib/phone/normalize.ts for the one place a raw input is ever
-- converted to this column's canonical E.164 value, and
-- src/app/(dashboard)/settings/account/actions.ts for the one place
-- this column is ever written.
--
-- Hand-authored (this environment's `prisma migrate dev`/`migrate diff`
-- cannot compute a diff here -- its shadow-database step fails against
-- the single-instance local PGlite Postgres this sandbox uses in place
-- of Docker/system Postgres, see test/support/local-postgres.ts's own
-- doc comment and 20261008000000_add_organization_demo_flag/
-- migration.sql's own identical note), matching exactly what Prisma
-- itself generates for a nullable-column-plus-unique-index addition to
-- an existing table (compare 20260729020105_init/migration.sql's own
-- "User_email_key" index for the same naming convention).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
