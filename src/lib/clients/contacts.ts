import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { ClientContact } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Multiple Contacts Phase 1 (data model foundation only — no UI yet; see
 * ClientContact's own doc comment in prisma/schema.prisma for the full
 * design story, and this migration's own header comment:
 * prisma/migrations/20260924090000_add_client_contacts_foundation).
 *
 * This is the "small contact-domain layer" the Phase 1 task called for —
 * plain async functions, not Server Actions bound to a form (there is no
 * Contacts UI yet to bind them to). createClientAction and
 * convertLeadToClientAction call createClientContact() directly, passing
 * their own open transaction, so a brand-new Client's primary contact is
 * created atomically alongside it (see those callers' own comments).
 *
 * Every function here is organization-scoped exactly like the rest of
 * this app's Client-family code (createClientAction/updateClientAction/
 * deleteClientAction) — a foreign-org id is always treated as
 * nonexistent, never a distinguishable "exists but denied" case.
 */

type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

export type ClientContactInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  isBilling?: boolean;
  isPortalContact?: boolean;
};

export type ClientContactMutationResult =
  | { ok: true; contact: ClientContact }
  | { ok: false; reason: "CLIENT_NOT_FOUND" | "CONTACT_NOT_FOUND" | "FOREIGN_CONTACT" | "ARCHIVED_CONTACT" | "CONCURRENT_PRIMARY_CHANGE" };

/**
 * Derives a display name for a ClientContact from nothing but an email —
 * used both when the caller creates a contact with no explicit name
 * available (not currently exposed as a public entry point here; kept for
 * the same reason resolvePortalUserName exists) and, in spirit, by this
 * feature's own backfill migration (see that migration's own header
 * comment for why Client.name is deliberately never copied here: it's
 * this app's business/account name, not reliably a person's — same
 * reasoning buildRecipientSnapshotV1's own `billingLegalName ?? company
 * ?? name` fallback chain already documents). Mirrors
 * resolvePortalUserName's exact fallback shape (src/app/portal/invite/
 * [token]/actions.ts): the email's local part, or a generic literal if
 * there's no email to derive one from at all.
 */
export function resolveFallbackContactName(email: string | null | undefined): string {
  const trimmed = (email ?? "").trim();
  if (!trimmed) return "Primary Contact";
  const localPart = trimmed.split("@")[0];
  return localPart || trimmed;
}

/**
 * Section I compatibility rule (Multiple Contacts Phase 1) — the
 * "contact -> Client.email" direction: whenever the active primary
 * contact is created/changed/re-pointed and its email is non-null,
 * Client.email is synchronized to that value in the same transaction.
 * When the primary contact has no email, Client.email is left untouched
 * (never blindly erased — matches Client.email's own existing "optional,
 * never required" semantics). See syncPrimaryContactEmailFromClientEdit
 * below for the reverse direction ("editing Client.email through the
 * existing Client form -> primary contact"), added by the "Close Legacy
 * Email Sync Gap" follow-up so the two directions can no longer silently
 * diverge during this still-UI-less transitional phase.
 */
async function syncClientEmailFromPrimaryContact(
  client: PrismaClientOrTx,
  clientId: string,
  contact: ClientContact,
): Promise<void> {
  if (contact.isPrimary && contact.archivedAt === null && contact.email) {
    await client.client.update({ where: { id: clientId }, data: { email: contact.email } });
  }
}

/**
 * Section B compatibility rule ("Close Legacy Email Sync Gap") — the
 * reverse half of syncClientEmailFromPrimaryContact above: called from
 * inside updateClientAction's own transaction, after Client.email has
 * already been written to `newEmail` by that same transaction. If an
 * active (non-archived) primary contact exists, its own email is updated
 * to match — including a `null` newEmail, when the existing Client form
 * is used to explicitly clear Client.email. That's a deliberate choice,
 * not an oversight: the existing Client form remains the one
 * authoritative compatibility UI during this transitional phase (there is
 * still no Contacts UI to edit the primary contact's email directly), so
 * clearing Client.email through it should clear the primary contact's
 * email too, rather than leaving a now-orphaned value nothing can any
 * longer see or fix. Never touches an archived or non-primary contact —
 * only the one row that also drives the forward direction above.
 *
 * The caller (updateClientAction) only invokes this when Client.email
 * genuinely changed, so this function itself doesn't re-check that
 * against the Client row — but it still independently no-ops when the
 * primary contact's own email already equals `newEmail`, so calling it
 * unconditionally would still be safe, just occasionally redundant.
 *
 * Deliberately NOT implemented by calling updateClientContact(): that
 * function's own write would immediately re-trigger the forward sync
 * above, writing Client.email right back to the exact value this
 * function was just given — harmless, but a pointless second write and a
 * confusing call graph for what is, in this direction, a single-column
 * update with no other ClientContact field ever in scope.
 */
export async function syncPrimaryContactEmailFromClientEdit(
  tx: Prisma.TransactionClient,
  organizationId: string,
  clientId: string,
  newEmail: string | null,
): Promise<void> {
  const primary = await tx.clientContact.findFirst({
    where: { organizationId, clientId, isPrimary: true, archivedAt: null },
  });
  if (!primary || primary.email === newEmail) return;

  await tx.clientContact.update({ where: { id: primary.id }, data: { email: newEmail } });
}

/** True only for the specific P2002 shape this table's own partial unique index produces (see this file's own setPrimaryClientContact/createClientContact callers). */
function isPrimaryConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const fields = (
    err.meta as { driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } } | undefined
  )?.driverAdapterError?.cause?.constraint?.fields;
  return Array.isArray(fields) && fields.length === 1 && fields[0] === '"clientId"';
}

/**
 * Every non-archived contact for a Client, primary first — organization
 * and Client scoped together (a foreign-org clientId returns an empty
 * list, never a distinguishable error). Pass `includeArchived: true` to
 * also see archived contacts (e.g. a future audit view) — excluded by
 * default, matching Lead's own archivedAt convention.
 */
export async function listClientContacts(
  organizationId: string,
  clientId: string,
  options: { includeArchived?: boolean } = {},
  client: PrismaClientOrTx = prisma,
): Promise<ClientContact[]> {
  return client.clientContact.findMany({
    where: {
      organizationId,
      clientId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
}

/** The one active primary contact for a Client, if any — null if there is none (a legitimate, expected state; see ClientContact's own "archiving the primary leaves no primary" comment). */
export async function getPrimaryClientContact(
  organizationId: string,
  clientId: string,
  client: PrismaClientOrTx = prisma,
): Promise<ClientContact | null> {
  return client.clientContact.findFirst({
    where: { organizationId, clientId, isPrimary: true, archivedAt: null },
  });
}

/**
 * Creates a new ClientContact for an existing Client. Re-verifies the
 * Client actually belongs to organizationId even when called from inside
 * a transaction that just created that exact Client — a cheap extra read,
 * and this app's own established "never trust an already-open
 * transaction's context alone" discipline (e.g. resolveQuoteTarget
 * re-validates target ownership unconditionally).
 *
 * `isPrimary: true` performs the full transactional primary switch
 * (Section H): any existing active primary for this Client is unset
 * first, in the same transaction/call — never a moment with two active
 * primaries. The partial unique index (see this feature's own migration)
 * is the real, database-enforced backstop; a P2002 against it here means
 * a genuinely concurrent request won the race and is surfaced as
 * CONCURRENT_PRIMARY_CHANGE rather than an unhandled exception.
 */
export async function createClientContact(
  organizationId: string,
  clientId: string,
  input: ClientContactInput & { isPrimary?: boolean },
  client: PrismaClientOrTx = prisma,
): Promise<ClientContactMutationResult> {
  const owningClient = await client.client.findFirst({ where: { id: clientId, organizationId }, select: { id: true } });
  if (!owningClient) {
    return { ok: false, reason: "CLIENT_NOT_FOUND" };
  }

  const wantsPrimary = input.isPrimary ?? false;

  // A Prisma TransactionClient (what `client` is when a caller like
  // createClientAction passes its own open `tx`) has no `$transaction` of
  // its own — nesting one is not valid Prisma usage. When `client` is the
  // top-level singleton, this opens its own transaction for the
  // unset-then-create pair; when `client` is already a `tx`, the two
  // writes just run against it directly — already atomic as part of the
  // caller's own outer transaction.
  const runCreate = (tx: PrismaClientOrTx) =>
    (async () => {
      if (wantsPrimary) {
        await tx.clientContact.updateMany({
          where: { clientId, isPrimary: true, archivedAt: null },
          data: { isPrimary: false },
        });
      }

      return tx.clientContact.create({
        data: {
          organizationId,
          clientId,
          name: input.name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          role: input.role ?? null,
          isPrimary: wantsPrimary,
          isBilling: input.isBilling ?? false,
          isPortalContact: input.isPortalContact ?? false,
        },
      });
    })();

  try {
    const contact = client === prisma ? await prisma.$transaction((tx) => runCreate(tx)) : await runCreate(client);
    await syncClientEmailFromPrimaryContact(client, clientId, contact);
    return { ok: true, contact };
  } catch (err) {
    if (isPrimaryConflict(err)) {
      return { ok: false, reason: "CONCURRENT_PRIMARY_CHANGE" };
    }
    throw err;
  }
}

/**
 * Updates an existing ClientContact's own fields. Deliberately has no
 * `clientId`/`organizationId` in its input type at all — a Contact can
 * never be re-parented to a different Client through this function (or
 * any function in this file); this is the update side of Section R's
 * "update cannot move a Contact to another Client" requirement, enforced
 * structurally rather than by a runtime check that could be forgotten.
 * Also has no `isPrimary` field — primary changes only ever go through
 * setPrimaryClientContact's own dedicated transactional switch, never
 * this function, so there is exactly one code path that can ever flip
 * isPrimary.
 */
export async function updateClientContact(
  organizationId: string,
  contactId: string,
  input: Partial<ClientContactInput>,
  client: PrismaClientOrTx = prisma,
): Promise<ClientContactMutationResult> {
  const existing = await client.clientContact.findFirst({ where: { id: contactId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "CONTACT_NOT_FOUND" };
  }

  const contact = await client.clientContact.update({
    where: { id: contactId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isBilling !== undefined ? { isBilling: input.isBilling } : {}),
      ...(input.isPortalContact !== undefined ? { isPortalContact: input.isPortalContact } : {}),
    },
  });

  // "its email changes" half of the Section I sync rule — only actually
  // writes anything when this contact is the active primary (see
  // syncClientEmailFromPrimaryContact's own guard).
  await syncClientEmailFromPrimaryContact(client, existing.clientId, contact);

  return { ok: true, contact };
}

/**
 * Soft-archives a ClientContact (archivedAt = now()). Idempotent: an
 * already-archived contact is returned unchanged rather than re-stamping
 * archivedAt. Deliberately does NOT unset isPrimary and does NOT promote
 * any other contact to primary (Section Q, Option B — the simpler MVP
 * choice) and does NOT touch Client.email — see ClientContact's own
 * schema comment and syncClientEmailFromPrimaryContact's own comment for
 * why leaving Client.email at its last-synced value is correct here, not
 * a bug.
 */
export async function archiveClientContact(
  organizationId: string,
  contactId: string,
  client: PrismaClientOrTx = prisma,
): Promise<ClientContactMutationResult> {
  const existing = await client.clientContact.findFirst({ where: { id: contactId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "CONTACT_NOT_FOUND" };
  }

  if (existing.archivedAt !== null) {
    return { ok: true, contact: existing };
  }

  const contact = await client.clientContact.update({
    where: { id: contactId },
    data: { archivedAt: new Date() },
  });

  return { ok: true, contact };
}

/**
 * Multiple Contacts Phase 2 (Staff UI) — the smallest safe unarchive rule,
 * added because Phase 1 deliberately left this unimplemented (no UI
 * existed yet to need it). Idempotent: an already-active contact is
 * returned unchanged. Always unarchives as non-primary
 * (`isPrimary: false`, unconditionally, in the same write as
 * `archivedAt: null`) — never attempts to "safely" restore a prior
 * `isPrimary: true` value, even though archiveClientContact's own
 * documented behavior leaves that column untouched (true) on an archived
 * row. That prior value cannot be trusted blindly: another contact may
 * have been set primary while this one was archived, and restoring
 * `isPrimary: true` here would either violate the partial unique index
 * (client_contact_one_active_primary) with a raw P2002 the caller would
 * have to somehow explain, or — worse — silently succeed and leave a
 * stale, wrong primary if the check were done sloppily. Forcing
 * non-primary sidesteps the whole class of hazard deterministically: an
 * unarchive can never violate the partial unique index, full stop, and
 * never touches Client.email either (a non-primary contact is never a
 * sync source). A user who wants this contact to be primary again uses
 * the ordinary "Set primary" action afterward — the same explicit,
 * single code path every other primary change already goes through.
 */
export async function unarchiveClientContact(
  organizationId: string,
  contactId: string,
  client: PrismaClientOrTx = prisma,
): Promise<ClientContactMutationResult> {
  const existing = await client.clientContact.findFirst({ where: { id: contactId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "CONTACT_NOT_FOUND" };
  }

  if (existing.archivedAt === null) {
    return { ok: true, contact: existing };
  }

  const contact = await client.clientContact.update({
    where: { id: contactId },
    data: { archivedAt: null, isPrimary: false },
  });

  return { ok: true, contact };
}

/**
 * The dedicated transactional primary switch (Section H) — the only
 * function in this file allowed to flip isPrimary. Validates the target
 * contact actually belongs to BOTH organizationId and clientId together
 * (never re-derived from the contact row alone) before touching anything,
 * so a crafted/foreign contactId can never be promoted to primary for a
 * Client it doesn't belong to (Section R). An archived contact can never
 * become primary — it must be un-archived first (there is no
 * un-archive function in Phase 1; this is a deliberate, documented gap
 * for a still-UI-less feature, not an oversight).
 */
export async function setPrimaryClientContact(
  organizationId: string,
  clientId: string,
  contactId: string,
  client: PrismaClientOrTx = prisma,
): Promise<ClientContactMutationResult> {
  const target = await client.clientContact.findFirst({ where: { id: contactId, organizationId, clientId } });
  if (!target) {
    return { ok: false, reason: "FOREIGN_CONTACT" };
  }
  if (target.archivedAt !== null) {
    return { ok: false, reason: "ARCHIVED_CONTACT" };
  }

  // Same nested-transaction constraint as createClientContact's own
  // runCreate — see that function's comment.
  const runSwitch = (tx: PrismaClientOrTx) =>
    (async () => {
      await tx.clientContact.updateMany({
        where: { clientId, isPrimary: true, archivedAt: null, id: { not: contactId } },
        data: { isPrimary: false },
      });

      return tx.clientContact.update({
        where: { id: contactId },
        data: { isPrimary: true },
      });
    })();

  try {
    const contact = client === prisma ? await prisma.$transaction((tx) => runSwitch(tx)) : await runSwitch(client);
    await syncClientEmailFromPrimaryContact(client, clientId, contact);
    return { ok: true, contact };
  } catch (err) {
    if (isPrimaryConflict(err)) {
      return { ok: false, reason: "CONCURRENT_PRIMARY_CHANGE" };
    }
    throw err;
  }
}
