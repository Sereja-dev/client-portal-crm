import { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./usage";
import { getOrganizationEntitlements } from "./entitlements";

/**
 * Aqenra Free plan — concurrency correction for the 1 GiB organization
 * storage ceiling (confirmed race, see test/integration/billing/free-
 * plan-concurrency-corrections.test.ts). Storage is never transactional
 * with Postgres — bytes land in Supabase Storage before the owning
 * Attachment/OrganizationProfile row is ever written — so a plain "read
 * current usage, then upload" check can never fully close the gap
 * between two near-simultaneous uploads that would each individually fit
 * under the quota but not both together: nothing serializes the check
 * against the DB write that eventually makes the usage real.
 *
 * `reserveStorageBytes` is the fix: a short-lived, DB-only "promise" of
 * bytes about to be consumed, created BEFORE the slow external Storage
 * call, under a per-organization Postgres advisory lock (so a second
 * concurrent reservation attempt for the SAME organization is forced to
 * wait for the first to finish its own check-and-reserve step, and then
 * sees the first reservation's bytes already counted — read-committed
 * isolation is sufficient once the check-then-write is serialized this
 * way, the same technique src/lib/permissions/management.ts's own
 * acquireRolePermissionLock already established for an analogous "count,
 * then write" race). The reservation must be released — via
 * `releaseStorageReservation` — the moment its own upload's outcome is
 * known, success or failure, so capacity is never permanently stranded
 * on a known failure path. A reservation nobody ever explicitly releases
 * (a crashed process, a release call that itself failed) self-heals via
 * `expiresAt`: the usage sum below only counts still-unexpired rows, so
 * an abandoned reservation simply stops counting after
 * RESERVATION_TTL_MS, with no cleanup job required for correctness.
 */
const RESERVATION_TTL_MS = 10 * 60 * 1000;

async function lockOrganizationForStorageReservation(
  client: PrismaClientOrTx,
  organizationId: string,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId} || ':storage-reservation', 0))`;
}

export type ReserveStorageBytesResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "STORAGE_LIMIT_REACHED" | "READ_ONLY_ACCESS" };

/**
 * Reserves `netAdditionalBytes` of storage for `organizationId`, failing
 * closed if the organization's current committed usage plus every other
 * currently-active reservation plus this request would exceed its
 * storage ceiling. `netAdditionalBytes` may be zero or negative (a
 * replacement that is the same size as, or smaller than, the object it
 * replaces) — such a request always succeeds without needing to reserve
 * anything, since it can only ever reduce total usage; see
 * uploadOrganizationLogo's own call site for why a logo replacement
 * computes this as `newSize - oldSize` rather than reserving the new
 * file's full size on top of the old one it is about to replace.
 *
 * Always runs inside its own fresh `prisma.$transaction` — a reservation
 * is a short, DB-only operation that must never be held open across the
 * slow external Storage call that follows it in the real upload flow
 * (holding a Postgres transaction/lock across that network round trip
 * would serialize every upload for an organization against every other,
 * not just the ones that actually contend for the same bytes — a far
 * worse throughput trade-off than the narrow, fast lock this function
 * actually takes).
 *
 * `prismaClient` defaults to this app's own singleton (every real call
 * site). Accepting an alternate, already-connected `PrismaClient`
 * explicitly (never a bare `Prisma.TransactionClient`, which has no
 * `$transaction` of its own to nest) is what lets test/integration/
 * billing/free-plan-concurrency-corrections.test.ts drive this function
 * against an isolated, genuinely multi-connection database instead of the
 * shared single-connection test harness.
 */
export async function reserveStorageBytes(
  organizationId: string,
  netAdditionalBytes: number,
  prismaClient: PrismaClient = prisma,
): Promise<ReserveStorageBytesResult> {
  if (netAdditionalBytes <= 0) {
    return { ok: true, reservationId: "" };
  }

  return prismaClient.$transaction(async (tx) => {
    await lockOrganizationForStorageReservation(tx, organizationId);

    const entitlements = await getOrganizationEntitlements(organizationId, { client: tx });
    if (entitlements.accessMode !== "FULL_ACCESS") {
      return { ok: false, reason: "READ_ONLY_ACCESS" };
    }

    const activeReservations = await tx.storageReservation.aggregate({
      where: { organizationId, expiresAt: { gt: new Date() } },
      _sum: { sizeBytes: true },
    });
    const alreadyReservedBytes = activeReservations._sum.sizeBytes ?? 0;

    const fits =
      entitlements.currentStorageBytes + alreadyReservedBytes + netAdditionalBytes <= entitlements.maxStorageBytes;
    if (!fits) {
      return { ok: false, reason: "STORAGE_LIMIT_REACHED" };
    }

    const reservation = await tx.storageReservation.create({
      data: {
        organizationId,
        sizeBytes: netAdditionalBytes,
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
      },
    });
    return { ok: true, reservationId: reservation.id };
  });
}

/**
 * Releases a reservation created by `reserveStorageBytes` — called
 * exactly once per non-empty reservation, on every outcome (the real
 * upload's own DB write committed, or any step after reservation failed)
 * so capacity is never stranded on a known failure path. A no-op,
 * deliberately never throwing, for the empty string `reserveStorageBytes`
 * returns for a zero/negative request (nothing was ever reserved, so
 * `deleteMany` simply matches zero rows) — this lets every call site
 * release unconditionally, with no special-casing for the "nothing to
 * release" case.
 */
export async function releaseStorageReservation(
  reservationId: string,
  prismaClient: PrismaClient = prisma,
): Promise<void> {
  if (!reservationId) return;
  await prismaClient.storageReservation.deleteMany({ where: { id: reservationId } });
}
