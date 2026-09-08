import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listClientContacts,
  getPrimaryClientContact,
  createClientContact,
  updateClientContact,
  archiveClientContact,
  setPrimaryClientContact,
  resolveFallbackContactName,
} from "@/lib/clients/contacts";
import { sendQuoteAction } from "@/app/(dashboard)/quotes/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Multiple Contacts Phase 1 — the domain-layer CRUD, security, and
 * cross-feature-compatibility coverage (items 19-29, 37-40 of that
 * feature's own test plan). Schema-level coverage lives in
 * contacts-schema-migration.test.ts; create-time/update-time/delete-time/
 * Lead-conversion coverage lives alongside the actions they touch
 * (create.test.ts, update.test.ts, delete.test.ts, leads/convert.test.ts).
 */

async function makeClient(organizationId: string, userId: string, overrides: Record<string, unknown> = {}) {
  return prisma.client.create({
    data: { name: `Contact-Test-${randomUUID().slice(0, 8)}`, organizationId, userId, ...overrides },
  });
}

describe("resolveFallbackContactName", () => {
  it("derives the email's local part when an email is present", () => {
    expect(resolveFallbackContactName("jane.smith@example.com")).toBe("jane.smith");
  });

  it("trims surrounding whitespace before splitting", () => {
    expect(resolveFallbackContactName("  jane@example.com  ")).toBe("jane");
  });

  it("falls back to the literal, generic placeholder when there is no email at all", () => {
    expect(resolveFallbackContactName(null)).toBe("Primary Contact");
    expect(resolveFallbackContactName(undefined)).toBe("Primary Contact");
    expect(resolveFallbackContactName("")).toBe("Primary Contact");
    expect(resolveFallbackContactName("   ")).toBe("Primary Contact");
  });

  it("degrades gracefully for a malformed email with no '@' at all — returns the whole string rather than crashing", () => {
    expect(resolveFallbackContactName("not-an-email")).toBe("not-an-email");
  });
});

describe("Client Contacts — domain layer CRUD/security/compatibility (Multiple Contacts Phase 1)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { name: { startsWith: "Contact-Test-" } } });
    await cleanupTestData(fixtures);
  });

  // ---------------------------------------------------------------------
  // CRUD (19-25)
  // ---------------------------------------------------------------------

  it("19. creating a second contact for the same Client succeeds, non-primary by default, alongside the first", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const first = await createClientContact(fixtures.orgA.id, client.id, { name: "First", isPrimary: true });
    expect(first.ok).toBe(true);

    const second = await createClientContact(fixtures.orgA.id, client.id, { name: "Second" });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected ok");
    expect(second.contact.isPrimary).toBe(false);

    const all = await listClientContacts(fixtures.orgA.id, client.id);
    expect(all).toHaveLength(2);
    // Primary first, per listClientContacts's own documented ordering.
    expect(all[0].name).toBe("First");
  });

  it("20. updateClientContact updates name/email/phone/role/isBilling/isPortalContact", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const created = await createClientContact(fixtures.orgA.id, client.id, { name: "Old Name" });
    if (!created.ok) throw new Error("expected ok");

    const updated = await updateClientContact(fixtures.orgA.id, created.contact.id, {
      name: "New Name",
      email: "new@example.com",
      phone: "555-0101",
      role: "Billing",
      isBilling: true,
      isPortalContact: true,
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error("expected ok");
    expect(updated.contact).toMatchObject({
      name: "New Name",
      email: "new@example.com",
      phone: "555-0101",
      role: "Billing",
      isBilling: true,
      isPortalContact: true,
    });
  });

  it("21/22. archiveClientContact soft-archives, and archived contacts are excluded by default but included with includeArchived", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const created = await createClientContact(fixtures.orgA.id, client.id, { name: "To Archive" });
    if (!created.ok) throw new Error("expected ok");

    const archived = await archiveClientContact(fixtures.orgA.id, created.contact.id);
    expect(archived.ok).toBe(true);
    if (!archived.ok) throw new Error("expected ok");
    expect(archived.contact.archivedAt).not.toBeNull();

    const defaultList = await listClientContacts(fixtures.orgA.id, client.id);
    expect(defaultList.find((c) => c.id === created.contact.id)).toBeUndefined();

    const fullList = await listClientContacts(fixtures.orgA.id, client.id, { includeArchived: true });
    expect(fullList.find((c) => c.id === created.contact.id)).toBeDefined();
  });

  it("archiving is idempotent — archiving an already-archived contact returns it unchanged rather than re-stamping archivedAt", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const created = await createClientContact(fixtures.orgA.id, client.id, { name: "Archive Twice" });
    if (!created.ok) throw new Error("expected ok");

    const firstArchive = await archiveClientContact(fixtures.orgA.id, created.contact.id);
    if (!firstArchive.ok) throw new Error("expected ok");
    const secondArchive = await archiveClientContact(fixtures.orgA.id, created.contact.id);
    expect(secondArchive.ok).toBe(true);
    if (!secondArchive.ok) throw new Error("expected ok");
    expect(secondArchive.contact.archivedAt?.getTime()).toBe(firstArchive.contact.archivedAt?.getTime());
  });

  it("23/24/25. setPrimaryClientContact promotes a new primary, unsets the old one, and never leaves two active primaries", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const a = await createClientContact(fixtures.orgA.id, client.id, { name: "A", email: "a@example.com", isPrimary: true });
    const b = await createClientContact(fixtures.orgA.id, client.id, { name: "B", email: "b@example.com" });
    if (!a.ok || !b.ok) throw new Error("expected ok");

    const switched = await setPrimaryClientContact(fixtures.orgA.id, client.id, b.contact.id);
    expect(switched.ok).toBe(true);
    if (!switched.ok) throw new Error("expected ok");
    expect(switched.contact.isPrimary).toBe(true);

    const aAfter = await prisma.clientContact.findUniqueOrThrow({ where: { id: a.contact.id } });
    expect(aAfter.isPrimary).toBe(false);

    const activePrimaries = await prisma.clientContact.findMany({
      where: { clientId: client.id, isPrimary: true, archivedAt: null },
    });
    expect(activePrimaries).toHaveLength(1);
    expect(activePrimaries[0].id).toBe(b.contact.id);

    // Section I compatibility: Client.email follows the new primary.
    const clientAfter = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(clientAfter.email).toBe("b@example.com");
  });

  it("setPrimaryClientContact refuses to promote an archived contact", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const created = await createClientContact(fixtures.orgA.id, client.id, { name: "Archived" });
    if (!created.ok) throw new Error("expected ok");
    await archiveClientContact(fixtures.orgA.id, created.contact.id);

    const result = await setPrimaryClientContact(fixtures.orgA.id, client.id, created.contact.id);
    expect(result).toEqual({ ok: false, reason: "ARCHIVED_CONTACT" });
  });

  it("getPrimaryClientContact returns null when there is no active primary (e.g. after archiving it, Section Q Option B)", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const created = await createClientContact(fixtures.orgA.id, client.id, { name: "Sole Primary", isPrimary: true });
    if (!created.ok) throw new Error("expected ok");
    await archiveClientContact(fixtures.orgA.id, created.contact.id);

    const primary = await getPrimaryClientContact(fixtures.orgA.id, client.id);
    expect(primary).toBeNull();
    // No automatic promotion of any other contact — there is none here,
    // and even if there were, archiving never touches other rows.
  });

  // ---------------------------------------------------------------------
  // Security (26-29)
  // ---------------------------------------------------------------------

  it("26. listClientContacts is scoped by organization — a foreign org's id returns an empty list, never another org's contacts", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    await createClientContact(fixtures.orgA.id, client.id, { name: "OrgA contact" });

    const result = await listClientContacts(fixtures.orgB.id, client.id);
    expect(result).toHaveLength(0);
  });

  it("27. updateClientContact is scoped by organization — a foreign org's id cannot update another org's contact", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const created = await createClientContact(fixtures.orgA.id, client.id, { name: "Protected" });
    if (!created.ok) throw new Error("expected ok");

    const result = await updateClientContact(fixtures.orgB.id, created.contact.id, { name: "Hijacked" });
    expect(result).toEqual({ ok: false, reason: "CONTACT_NOT_FOUND" });

    const unchanged = await prisma.clientContact.findUniqueOrThrow({ where: { id: created.contact.id } });
    expect(unchanged.name).toBe("Protected");
  });

  it("28. a contact can never be re-parented to a different Client — updateClientContact's own input type has no clientId field, and a smuggled one is silently ignored", async () => {
    const clientA = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const clientB = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const created = await createClientContact(fixtures.orgA.id, clientA.id, { name: "Stays Put" });
    if (!created.ok) throw new Error("expected ok");

    const result = await updateClientContact(fixtures.orgA.id, created.contact.id, {
      name: "Still Stays Put",
      ...({ clientId: clientB.id } as object),
    });
    expect(result.ok).toBe(true);

    const after = await prisma.clientContact.findUniqueOrThrow({ where: { id: created.contact.id } });
    expect(after.clientId).toBe(clientA.id);
  });

  it("29. setPrimaryClientContact cannot target a contact belonging to a different Client — crafted clientId/contactId pairs are rejected", async () => {
    const clientA = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const clientB = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const contactOnB = await createClientContact(fixtures.orgA.id, clientB.id, { name: "Belongs to B" });
    if (!contactOnB.ok) throw new Error("expected ok");

    const result = await setPrimaryClientContact(fixtures.orgA.id, clientA.id, contactOnB.contact.id);
    expect(result).toEqual({ ok: false, reason: "FOREIGN_CONTACT" });

    const stillNotPrimaryAnywhere = await prisma.clientContact.findUniqueOrThrow({ where: { id: contactOnB.contact.id } });
    expect(stillNotPrimaryAnywhere.isPrimary).toBe(false);
  });

  it("setPrimaryClientContact also rejects a cross-organization contactId (no Portal access to Staff contact actions is a related but separate guarantee — Portal never imports this module at all)", async () => {
    const client = await makeClient(fixtures.orgB.id, fixtures.orgBOwner.id);
    const foreignContact = await createClientContact(fixtures.orgB.id, client.id, { name: "OrgB contact" });
    if (!foreignContact.ok) throw new Error("expected ok");

    const result = await setPrimaryClientContact(fixtures.orgA.id, client.id, foreignContact.contact.id);
    expect(result).toEqual({ ok: false, reason: "FOREIGN_CONTACT" });
  });

  it("createClientContact rejects a clientId that does not belong to the given organization", async () => {
    const foreignClient = await makeClient(fixtures.orgB.id, fixtures.orgBOwner.id);

    const result = await createClientContact(fixtures.orgA.id, foreignClient.id, { name: "Should not exist" });
    expect(result).toEqual({ ok: false, reason: "CLIENT_NOT_FOUND" });

    const contacts = await prisma.clientContact.findMany({ where: { clientId: foreignClient.id } });
    expect(contacts).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // Portal unaffected (37/38 — 39 is covered by the full, unmodified
  // Portal test suite continuing to pass; see the Phase 1 report)
  // ---------------------------------------------------------------------

  it("37/38. PortalUser semantics are completely unaffected by a Client also having ClientContacts — clientId invariant, no auto-conversion, isPortalContact never auto-set", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id, { email: "client@example.com" });
    await createClientContact(fixtures.orgA.id, client.id, { name: "Contact", email: "contact@example.com", isPrimary: true });

    const portalUserId = randomUUID();
    const portalUser = await prisma.portalUser.create({
      data: { id: portalUserId, clientId: client.id, email: "portal-login@example.com", name: "Portal Login" },
    });

    // Still exactly one Client per PortalUser, untouched by any contact.
    expect(portalUser.clientId).toBe(client.id);
    // No ClientContact was created FOR the PortalUser, and no existing
    // contact was silently linked to it — isPortalContact stays false on
    // every contact for this Client (Phase 1 never sets it anywhere).
    const contacts = await prisma.clientContact.findMany({ where: { clientId: client.id } });
    expect(contacts.every((c) => c.isPortalContact === false)).toBe(true);

    await prisma.portalUser.deleteMany({ where: { id: portalUserId } });
  });

  // ---------------------------------------------------------------------
  // Quote/Invoice recipient logic unaffected (40) — Phase 1 deliberately
  // makes zero changes to Quote/Invoice code (see Section N of the Phase
  // 1 task); this proves recipient derivation still reads Client.name/
  // email directly and correctly, unaffected by a ClientContact existing
  // alongside it.
  // ---------------------------------------------------------------------

  it("40. Quote sendQuoteAction's recipientName/recipientEmail are still derived straight from Client.name/email, unaffected by a ClientContact existing for that Client", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id, {
      email: "recipient@example.com",
    });
    await createClientContact(fixtures.orgA.id, client.id, { name: "recipient", email: "recipient@example.com", isPrimary: true });

    const quote = await prisma.quote.create({
      data: {
        organizationId: fixtures.orgA.id,
        number: `Q-CONTACT-RECIPIENT-${randomUUID().slice(0, 8)}`,
        clientId: client.id,
        status: "DRAFT",
        subtotal: "50.00",
        total: "50.00",
        createdByUserId: fixtures.owner.id,
      },
    });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await sendQuoteAction(quote.id);
    expect(result.ok).toBe(true);

    const sent = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(sent.recipientName).toBe(client.name);
    expect(sent.recipientEmail).toBe("recipient@example.com");

    await prisma.quote.deleteMany({ where: { id: quote.id } });
  });
});
