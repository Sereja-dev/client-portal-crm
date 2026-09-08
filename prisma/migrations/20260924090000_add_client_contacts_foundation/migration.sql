/*
  Multiple Contacts Phase 1 — data model foundation (see ClientContact's
  own doc comment in prisma/schema.prisma for the full design story). One
  migration, three parts: (1) create the ClientContact table with its
  ordinary indexes and foreign keys, (2) add the partial unique index that
  enforces "at most one active primary contact per Client" — not
  expressible in the Prisma schema DSL, same reasoning as
  InvoiceEmailAttempt's own "one PENDING attempt per invoice" index (see
  that model's comment; that index also lives only in its own
  migration.sql, never in schema.prisma), and (3) a one-time backfill that
  gives every existing Client with real contact data (email and/or phone)
  exactly one primary ClientContact.

  Production read-only preflight (counts only, taken before writing this
  migration, via a temporary local script deleted immediately after —
  never checked in): 11 Clients total, 8 with email, 4 with phone, 4 with
  both, 3 with neither, 0 with a null organizationId, 8 distinct emails,
  0 duplicate emails within the same organization. This migration was
  NOT applied to Production as part of authoring it — only against this
  repository's local, ephemeral PGlite-backed test harness (test/support/
  local-postgres.ts), exactly like every other migration in this project.

  Backfill trigger condition: a Client gets a backfilled primary contact
  only when it has email and/or phone — a Client with neither (3 of the
  11 Production rows above) gets no contact at all, deliberately
  conservative rather than creating an empty placeholder for every single
  Client just because `name` is always present.

  Backfill name-fallback rule (the one genuinely judgment-call part of
  this migration, spelled out in full): Client.name is NOT copied onto
  the backfilled contact's own name. Client.name functions as this app's
  business/account display name, not reliably a person's name — confirmed
  by existing precedent: buildRecipientSnapshotV1's own documented
  fallback chain (src/lib/invoices/pdf/snapshot-types.ts) is
  `billingLegalName ?? company ?? name`, i.e. `name` is already treated as
  the last-resort *business* name, not a person's. Copying it onto a
  person-shaped ClientContact.name would misrepresent a business account
  name as if it were a contact's own name. Instead: when the Client has an
  email, the contact's name falls back to that email's local part (the
  substring before '@') — identical in spirit to this codebase's own
  established resolvePortalUserName() fallback (src/app/portal/invite/
  [token]/actions.ts), which does exactly this for a brand-new PortalUser
  with no display name available. When the Client has no email (phone
  only), the contact's name falls back to the literal, honest placeholder
  'Primary Contact' — name is a required column on ClientContact, and
  fabricating a plausible-looking person name from nothing would be worse
  than an explicit, obviously-generic placeholder. (In the actual
  Production data above this phone-only-no-email case does not currently
  occur — every Client with a phone also has an email — but the backfill
  below handles it correctly regardless, since it must be correct in
  general, not just for today's data.) The exact same rule is implemented
  in application code going forward for newly-created Clients/Lead
  conversions — see resolveFallbackContactName() in
  src/lib/clients/contacts.ts; this SQL is its one-time historical twin.

  No PII beyond what already existed in the Client table itself is
  introduced — email/phone are copied verbatim from the same Client row,
  never a new value invented, and the contact's own name is either
  derived from that same email or a fully generic literal.

  No existing Client/PortalUser/Invoice/Quote row is modified by this
  migration in any way — this file only INSERTs new ClientContact rows
  and CREATEs new schema objects.

  No explicit BEGIN/COMMIT — `prisma migrate deploy` already wraps every
  migration.sql file's statements in its own transaction (verified
  directly against this exact toolchain by the 20260911090000 migration's
  own doc comment); an explicit one adds no additional safety here and
  only degrades error messages on failure, per that same finding.
*/

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isBilling" BOOLEAN NOT NULL DEFAULT false,
    "isPortalContact" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientContact_organizationId_idx" ON "ClientContact"("organizationId");

-- CreateIndex
CREATE INDEX "ClientContact_clientId_idx" ON "ClientContact"("clientId");

-- CreateIndex
CREATE INDEX "ClientContact_email_idx" ON "ClientContact"("email");

-- CreateIndex
CREATE INDEX "ClientContact_clientId_archivedAt_idx" ON "ClientContact"("clientId", "archivedAt");

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Primary-contact invariant: at most one ACTIVE (non-archived) primary
-- contact per Client. Deliberately raw/partial — see this file's own
-- header comment and ClientContact's schema.prisma comment for why an
-- ordinary @@unique cannot express this (it would forbid every
-- legitimate archived-and/or-non-primary row sharing a clientId).
CREATE UNIQUE INDEX "client_contact_one_active_primary" ON "ClientContact"("clientId") WHERE "isPrimary" = true AND "archivedAt" IS NULL;

-- Backfill: exactly one primary ClientContact for every existing Client
-- that has real contact data (email and/or phone) and a non-null
-- organizationId. See this file's own header comment for the full
-- name-fallback rule. gen_random_uuid() is available natively on both
-- this project's real Postgres target (Supabase, Postgres 15+) and its
-- local PGlite-backed test harness (a real Postgres engine compiled to
-- WASM) — no extension needs to be enabled for it.
INSERT INTO "ClientContact" (
    "id", "organizationId", "clientId", "name", "email", "phone",
    "isPrimary", "isBilling", "isPortalContact", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(),
    c."organizationId",
    c."id",
    CASE
        WHEN c."email" IS NOT NULL THEN split_part(c."email", '@', 1)
        ELSE 'Primary Contact'
    END,
    c."email",
    c."phone",
    true,
    false,
    false,
    now(),
    now()
FROM "Client" c
WHERE c."organizationId" IS NOT NULL
  AND (c."email" IS NOT NULL OR c."phone" IS NOT NULL);
