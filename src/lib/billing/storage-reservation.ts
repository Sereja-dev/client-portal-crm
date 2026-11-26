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

/**
 * The one "does this many additional bytes still fit" computation —
 * shared by `reserveStorageBytes`'s own authoritative check and
 * `consumeStorageReservation`'s own best-effort, message-only re-check
 * below, so the two can never silently drift apart into two different
 * definitions of "fits". A plain read: never creates, updates, or deletes
 * anything, and never itself claims any capacity — callers that need an
 * actual, race-safe reservation must still go through
 * `reserveStorageBytes`'s own locked transaction.
 */
async function fitsRightNow(
  client: PrismaClientOrTx,
  organizationId: string,
  netAdditionalBytes: number,
  now: Date,
): Promise<boolean> {
  const entitlements = await getOrganizationEntitlements(organizationId, { client });
  const activeReservations = await client.storageReservation.aggregate({
    where: { organizationId, expiresAt: { gt: now } },
    _sum: { sizeBytes: true },
  });
  const alreadyReservedBytes = activeReservations._sum.sizeBytes ?? 0;
  return entitlements.currentStorageBytes + alreadyReservedBytes + netAdditionalBytes <= entitlements.maxStorageBytes;
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
 *
 * `options.requireFullAccess` (default `true`, matching every pre-
 * existing call site — Attachments, Logos) gates this reservation on the
 * organization's billing `accessMode`, the same system-wide "no new
 * resources while read-only" rule `assertCanCreateClient`/
 * `assertCanInviteMember`/etc. already enforce. Invoice issuance passes
 * `false` here deliberately: this task is scoped to the STORAGE quota
 * only, and invoice issuance has never been gated by billing accessMode
 * at all (docs/billing-architecture.md's own "Invoices... never a
 * limited dimension" note) — silently adding that gate as a side effect
 * of this storage check would tighten an existing organization's
 * conditions in a way nothing in this task asked for. Only the storage
 * ceiling itself is ever enforced for that caller.
 */
export async function reserveStorageBytes(
  organizationId: string,
  netAdditionalBytes: number,
  prismaClient: PrismaClient = prisma,
  options?: { requireFullAccess?: boolean },
): Promise<ReserveStorageBytesResult> {
  if (netAdditionalBytes <= 0) {
    return { ok: true, reservationId: "" };
  }
  const requireFullAccess = options?.requireFullAccess ?? true;

  return prismaClient.$transaction(async (tx) => {
    await lockOrganizationForStorageReservation(tx, organizationId);

    const entitlements = await getOrganizationEntitlements(organizationId, { client: tx });
    if (requireFullAccess && entitlements.accessMode !== "FULL_ACCESS") {
      return { ok: false, reason: "READ_ONLY_ACCESS" };
    }

    const fits = await fitsRightNow(tx, organizationId, netAdditionalBytes, new Date());
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
 * Thrown by a caller's own final transaction when the reservation it
 * relied on is no longer valid by commit time — see
 * `consumeStorageReservation`'s own doc comment for the exact race this
 * closes. `confirmedFull` is `consumeStorageReservation`'s own best-effort
 * classification of WHY: `true` only when a fresh, same-transaction
 * re-check finds the organization's real capacity genuinely exhausted
 * right now; `false` whenever that re-check finds room (the reservation
 * merely outlived its own TTL, with nothing to show it was ever actually
 * needed for real pressure). A caller must map `true` to its existing,
 * confirmed "storage limit reached" error/message, and `false` to a
 * distinct, neutral "this took too long, try again" error/message that
 * never asserts the organization is out of space — see each call site's
 * own mapping. Either way this error must never escape as a raw,
 * unhandled exception.
 */
export class StorageReservationLostError extends Error {
  readonly confirmedFull: boolean;

  constructor(confirmedFull: boolean) {
    super("StorageReservationLostError");
    this.name = "StorageReservationLostError";
    this.confirmedFull = confirmedFull;
  }
}

export type ConsumeStorageReservationResult =
  | { ok: true }
  | { ok: false; confirmedFull: boolean };

/**
 * The other half of the concurrency correction `reserveStorageBytes`
 * only started: closes the confirmed race where
 *
 *   1. An operation reserves N bytes.
 *   2. Its reservation's TTL elapses while the operation is still in
 *      flight (a genuinely slow external Storage call, or any other
 *      delay) — `reserveStorageBytes`'s own usage aggregate stops
 *      counting an expired reservation the moment this happens, exactly
 *      as designed (self-healing for an abandoned/crashed operation).
 *   3. A second, independent operation now sees those bytes as free,
 *      reserves and commits its own real write using them.
 *   4. The first operation, unaware its own reservation is gone,
 *      finishes anyway and commits its own real write too — together,
 *      steps 3 and 4 can exceed the organization's storage ceiling.
 *
 * `reserveStorageBytes` alone cannot close this on its own: it only ever
 * runs once, BEFORE the slow external Storage call, never consulted
 * again afterward. `consumeStorageReservation` is the missing other
 * half: called as the FIRST statement inside the exact same transaction
 * that performs the real, quota-counting write (the Attachment/
 * OrganizationProfile/InvoicePdfArchiveObject row), it re-verifies the
 * reservation is still alive and deletes it, atomically, as part of that
 * one commit. If the reservation already expired (or was otherwise
 * removed) by this point, nothing proceeds to the quota-counting write —
 * nothing commits, and the ordinary post-failure `releaseStorageReservation`
 * call every existing call site already makes then tidies up the
 * now-moot, already-expired row. This safety property is unconditional
 * and is never weakened by the message-classification work below.
 *
 * A reservation that is still alive at this exact instant is thereby
 * guaranteed to never be double-counted: this function performs, inside
 * the SAME transaction as the write that makes its bytes "real" usage,
 * exactly the delete every call site's post-commit `releaseStorageReservation`
 * call already did — the fix is moving that consumption inside the
 * transaction and gating it on `expiresAt` (never merely `id`), not a
 * mechanically different operation.
 *
 * On failure, this function does ONE more thing a bare "is my row still
 * there" check cannot: a confirmed storage-reservation review (the
 * reservation-expiry correction above was previously found to report
 * "storage limit reached" unconditionally for ANY lost reservation, even
 * one that outlived its TTL with the organization nowhere near full and
 * nobody else ever claiming the space — a confirmed, reproducible,
 * misleading message) asked for a reliable distinction here. `fitsRightNow`
 * — the exact same "does this still fit" computation `reserveStorageBytes`
 * itself uses — is re-run, inside this SAME transaction, against the
 * CALLER-SUPPLIED `organizationId`/`netAdditionalBytes` (never re-derived
 * from the now-possibly-gone reservation row, so this still works even
 * when the row was deleted outright rather than merely expired). If it
 * still fits, the only honest conclusion is that this reservation simply
 * outlived its own TTL with no real pressure behind it — `confirmedFull:
 * false`. If it genuinely does not fit, `confirmedFull: true`. This
 * extra read is NEVER authoritative capacity enforcement by itself (that
 * already happened, exactly once, in `reserveStorageBytes`'s own locked
 * check) and never creates, renews, or substitutes for a reservation —
 * it exists ONLY to choose the more accurate of two safe, non-committing
 * messages; the write is refused either way.
 *
 * Takes `now` as an explicit parameter — never `new Date()` internally —
 * so a caller with its own already-injected clock (issueInvoice()'s and
 * archiveLegacyInvoice()'s own `deps.now()`) can drive this check
 * deterministically too, which is what lets
 * free-plan-concurrency-corrections.test.ts reproduce this exact race
 * without a real 10-minute wait.
 *
 * The empty-string reservationId sentinel (nothing was ever reserved —
 * `reserveStorageBytes`'s own zero/negative-bytes short circuit) always
 * succeeds trivially, consistent with `releaseStorageReservation`
 * accepting the same sentinel as a safe no-op.
 */
export async function consumeStorageReservation(
  tx: PrismaClientOrTx,
  organizationId: string,
  reservationId: string,
  netAdditionalBytes: number,
  now: Date,
): Promise<ConsumeStorageReservationResult> {
  if (!reservationId) return { ok: true };
  const result = await tx.storageReservation.deleteMany({
    where: { id: reservationId, expiresAt: { gt: now } },
  });
  if (result.count > 0) return { ok: true };

  const confirmedFull = !(await fitsRightNow(tx, organizationId, netAdditionalBytes, now));
  return { ok: false, confirmedFull };
}

/**
 * Releases a reservation created by `reserveStorageBytes` — called on
 * every FAILURE exit after a successful reserve (the real write never
 * committed, for any reason, so capacity must never stay stranded on a
 * known failure path). The success path no longer calls this: the
 * reservation is instead consumed atomically, inside the same
 * transaction as the real write, by `consumeStorageReservation` above —
 * calling this afterward on success would be a redundant no-op (the row
 * is already gone), so it is not called there at all. A no-op,
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
