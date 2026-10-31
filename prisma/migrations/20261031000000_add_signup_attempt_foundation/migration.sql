-- Platform Admin Growth V1, Slice A (registration data foundation).
-- Purely additive: two new enums and one new table. No existing table,
-- column, row or constraint is touched, and nothing is backfilled here --
-- historical identities are recorded only by a separate, explicitly
-- approved backfill (recordedVia = 'BACKFILL'). See SignupAttempt's own
-- schema.prisma doc comment for the full semantics.
--
-- "authUserId" is unique but deliberately NOT a foreign key: the row is
-- written when the Supabase Auth user is created, before the application
-- "User" row exists.
--
-- The two indexes serve the Growth page's bounded 7/30/90-day windows
-- (firstAttemptedAt for signup attempts, activatedAt for activations) and
-- its sorted, paginated directory. Email search is a case-insensitive
-- contains, which a btree index cannot serve, so none is added.
--
-- Hand-authored for the same reason as the neighbouring migrations (this
-- environment's `prisma migrate diff` cannot compute a diff against the
-- single-instance local PGlite Postgres), matching what Prisma itself
-- generates for new enums, a table and indexes.

-- CreateEnum
CREATE TYPE "SignupOrigin" AS ENUM ('STANDALONE', 'INVITED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SignupRecordedVia" AS ENUM ('LIVE', 'BACKFILL');

-- CreateTable
CREATE TABLE "SignupAttempt" (
    "id" UUID NOT NULL,
    "authUserId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "origin" "SignupOrigin" NOT NULL,
    "firstAttemptedAt" TIMESTAMP(3) NOT NULL,
    "lastAttemptedAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "activatedAt" TIMESTAMP(3),
    "recordedVia" "SignupRecordedVia" NOT NULL DEFAULT 'LIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignupAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignupAttempt_authUserId_key" ON "SignupAttempt"("authUserId");

-- CreateIndex
CREATE INDEX "SignupAttempt_firstAttemptedAt_idx" ON "SignupAttempt"("firstAttemptedAt");

-- CreateIndex
CREATE INDEX "SignupAttempt_activatedAt_idx" ON "SignupAttempt"("activatedAt");

-- CHECK: defense in depth only -- application code never writes a count
-- below 1 and keeps firstAttemptedAt <= lastAttemptedAt by construction
-- (the first is only ever lowered and the last only ever raised, see
-- src/lib/signup-attempts/record.ts). These close the gap against a
-- future bug breaking either invariant silently.
ALTER TABLE "SignupAttempt" ADD CONSTRAINT "SignupAttempt_attemptCount_positive_check" CHECK ("attemptCount" >= 1);
ALTER TABLE "SignupAttempt" ADD CONSTRAINT "SignupAttempt_attempt_window_check" CHECK ("lastAttemptedAt" >= "firstAttemptedAt");
