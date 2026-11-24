-- Aqenra Free plan — concurrency correction for the 1 GiB organization
-- storage ceiling.
--
-- Confirmed race (see test/integration/billing/free-plan-concurrency-
-- corrections.test.ts's deterministic, barrier-synchronized reproduction):
-- the pre-existing "read current usage, then upload" check
-- (assertCanUploadAttachment) is a plain, unlocked read with no
-- transactional tie to the real Storage write that follows it. Two
-- uploads that each individually fit under the quota, but not both
-- together, could previously both pass the check and both land, because
-- nothing serialized the check against the eventual write and Storage
-- itself is never transactional with Postgres.
--
-- This table is a short-lived, DB-only reservation of bytes about to be
-- consumed, created under a per-organization Postgres advisory lock
-- (reserveStorageBytes, src/lib/billing/storage-reservation.ts) BEFORE
-- the slow external Storage call, so a second concurrent reservation
-- attempt for the same organization is forced to wait for the first to
-- finish its own check-and-reserve step and sees the first reservation's
-- bytes already counted. The reservation is deleted immediately once the
-- real upload's own DB write commits (releaseStorageReservation) or on
-- any failure along the way — never left stranded on a known failure
-- path. A reservation that is never explicitly released (a crashed
-- process, a release that itself failed) self-heals via `expiresAt`:
-- reserveStorageBytes's own usage sum only counts still-unexpired rows,
-- so an abandoned reservation simply stops counting after its TTL, with
-- no cleanup job required for correctness.
--
-- Purely additive — a brand-new table, no existing column, data, or
-- constraint touched. Old application code (which has never heard of
-- this table) is completely unaffected: it never queries or writes it,
-- and its own storage-usage reads are unchanged by this migration. New
-- code's own reservation logic requires this table to exist before it
-- can run, so the correct and sufficient rollout order is the one this
-- repo already uses for every additive migration: migrate, then deploy.
-- There is nothing to backfill — a reservation only ever represents an
-- upload that is currently in flight at the moment this ships, and there
-- is no way (or need) to reconstruct that transient state retroactively;
-- every reservation that exists at any later point was created by the
-- new code itself.
--
-- Rollback: dropping this table is always safe and lossless on its own
-- terms — every row in it is, by construction, either already resolved
-- (and therefore already deleted) or a short-lived in-flight promise
-- that will expire within RESERVATION_TTL_MS regardless. Rolling back to
-- the OLD application code while this table still exists is also safe:
-- old code never references it, so its rows (if any are still live) are
-- simply never read or written by the old code path — they just expire
-- on their own schedule and are never looked at again until a newer
-- deploy reintroduces code that reads this table.
-- CreateTable
CREATE TABLE "StorageReservation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorageReservation_organizationId_expiresAt_idx" ON "StorageReservation"("organizationId", "expiresAt");

-- AddForeignKey
ALTER TABLE "StorageReservation" ADD CONSTRAINT "StorageReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
