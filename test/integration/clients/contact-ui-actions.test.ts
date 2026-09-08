import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createContactAction,
  updateContactAction,
  archiveContactAction,
  unarchiveContactAction,
  setPrimaryContactAction,
} from "@/app/(dashboard)/clients/[id]/edit/contact-actions";
import { createClientContact } from "@/lib/clients/contacts";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Multiple Contacts Phase 2 (Staff UI) — the Server Action layer's own
 * test plan items (3-23): add/edit/optional-fields/duplicate-email/
 * primary-switch/email-sync/archive/unarchive, plus the full cross-org
 * security suite. The underlying domain-layer behavior (createClientContact,
 * updateClientContact, setPrimaryClientContact, archiveClientContact,
 * unarchiveClientContact) is already covered exhaustively in
 * contacts.test.ts — this file proves the thin Server Action wrapper
 * (org resolution, form parsing, error mapping) behaves correctly on top
 * of it, not the domain logic itself again.
 */

function buildContactFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

async function makeClient(organizationId: string, userId: string) {
  return prisma.client.create({
    data: { name: `Contact-UI-Test-${randomUUID().slice(0, 8)}`, organizationId, userId },
  });
}

describe("Client Contact Server Actions (Multiple Contacts Phase 2)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { name: { startsWith: "Contact-UI-Test-" } } });
    await cleanupTestData(fixtures);
  });

  // ---------------------------------------------------------------------
  // createContactAction (3, 4, 5, 6)
  // ---------------------------------------------------------------------

  it("3/4. createContactAction adds a contact with all fields, and is retrievable afterward", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await createContactAction(
      client.id,
      { error: null },
      buildContactFormData({ name: "Jane Smith", email: "jane@example.com", phone: "555-0100", role: "Owner" }),
    );

    expect(result).toEqual({ error: null });
    const contact = await prisma.clientContact.findFirstOrThrow({ where: { clientId: client.id } });
    expect(contact).toMatchObject({ name: "Jane Smith", email: "jane@example.com", phone: "555-0100", role: "Owner" });
  });

  it("5. optional fields (email/phone/role) may all be omitted", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await createContactAction(client.id, { error: null }, buildContactFormData({ name: "Bare Contact" }));

    expect(result).toEqual({ error: null });
    const contact = await prisma.clientContact.findFirstOrThrow({ where: { clientId: client.id, name: "Bare Contact" } });
    expect(contact.email).toBeNull();
    expect(contact.phone).toBeNull();
    expect(contact.role).toBeNull();
  });

  it("6. the same email may exist on multiple Contacts (no global uniqueness) — a duplicate is allowed", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const shared = "shared-contact-email@example.com";
    await createContactAction(client.id, { error: null }, buildContactFormData({ name: "First", email: shared }));
    const second = await createContactAction(client.id, { error: null }, buildContactFormData({ name: "Second", email: shared }));

    expect(second).toEqual({ error: null });
    const withEmail = await prisma.clientContact.findMany({ where: { clientId: client.id, email: shared } });
    expect(withEmail).toHaveLength(2);
  });

  it("a validation error (missing name) returns fieldErrors and creates nothing", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await createContactAction(client.id, { error: null }, buildContactFormData({ name: "" }));

    expect(result).toEqual({ error: null, fieldErrors: { name: "Name is required." } });
    expect(await prisma.clientContact.count({ where: { clientId: client.id } })).toBe(0);
  });

  it("7/8/9. creating a contact with Primary checked performs the full atomic switch — old primary unset, Client.email syncs", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const existingPrimary = await createClientContact(fixtures.orgA.id, client.id, {
      name: "Existing Primary",
      email: "existing@example.com",
      isPrimary: true,
    });
    if (!existingPrimary.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await createContactAction(
      client.id,
      { error: null },
      buildContactFormData({ name: "New Primary", email: "new-primary@example.com", isPrimary: "on" }),
    );
    expect(result).toEqual({ error: null });

    const oldPrimaryAfter = await prisma.clientContact.findUniqueOrThrow({ where: { id: existingPrimary.contact.id } });
    expect(oldPrimaryAfter.isPrimary).toBe(false);

    const newPrimary = await prisma.clientContact.findFirstOrThrow({ where: { clientId: client.id, name: "New Primary" } });
    expect(newPrimary.isPrimary).toBe(true);

    const clientAfter = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(clientAfter.email).toBe("new-primary@example.com");
  });

  // ---------------------------------------------------------------------
  // updateContactAction (10, plus general edit coverage)
  // ---------------------------------------------------------------------

  it("editing a contact's fields updates them, without ever accepting an isPrimary field", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const created = await createClientContact(fixtures.orgA.id, client.id, { name: "Old Name" });
    if (!created.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateContactAction(
      created.contact.id,
      client.id,
      { error: null },
      buildContactFormData({ name: "New Name", email: "new@example.com", phone: "555-0199", role: "Billing", isBilling: "on" }),
    );

    expect(result).toEqual({ error: null });
    const updated = await prisma.clientContact.findUniqueOrThrow({ where: { id: created.contact.id } });
    expect(updated).toMatchObject({ name: "New Name", email: "new@example.com", phone: "555-0199", role: "Billing", isBilling: true });
  });

  it("10. editing the active primary contact's own email still synchronizes Client.email", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const primary = await createClientContact(fixtures.orgA.id, client.id, {
      name: "Primary",
      email: "old-primary-email@example.com",
      isPrimary: true,
    });
    if (!primary.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await updateContactAction(
      primary.contact.id,
      client.id,
      { error: null },
      buildContactFormData({ name: "Primary", email: "updated-primary-email@example.com" }),
    );

    const clientAfter = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(clientAfter.email).toBe("updated-primary-email@example.com");
  });

  // ---------------------------------------------------------------------
  // archive / unarchive (11, 12, 15)
  // ---------------------------------------------------------------------

  it("11. archiving a secondary contact hides it from the default (active) list", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const secondary = await createClientContact(fixtures.orgA.id, client.id, { name: "Secondary" });
    if (!secondary.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await archiveContactAction(secondary.contact.id, client.id);

    const contact = await prisma.clientContact.findUniqueOrThrow({ where: { id: secondary.contact.id } });
    expect(contact.archivedAt).not.toBeNull();
  });

  it("12. archiving the current primary leaves a valid state — the Client simply has no active primary until one is chosen", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const primary = await createClientContact(fixtures.orgA.id, client.id, { name: "Primary", isPrimary: true });
    if (!primary.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await archiveContactAction(primary.contact.id, client.id);

    const activePrimaries = await prisma.clientContact.findMany({
      where: { clientId: client.id, isPrimary: true, archivedAt: null },
    });
    expect(activePrimaries).toHaveLength(0);
  });

  it("15. unarchiveContactAction restores an archived contact to the active list", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const contact = await createClientContact(fixtures.orgA.id, client.id, { name: "Comes Back" });
    if (!contact.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);
    await archiveContactAction(contact.contact.id, client.id);

    await unarchiveContactAction(contact.contact.id, client.id);

    const after = await prisma.clientContact.findUniqueOrThrow({ where: { id: contact.contact.id } });
    expect(after.archivedAt).toBeNull();
  });

  // ---------------------------------------------------------------------
  // setPrimaryContactAction
  // ---------------------------------------------------------------------

  it("setPrimaryContactAction promotes the target contact and unsets the old primary", async () => {
    const client = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const a = await createClientContact(fixtures.orgA.id, client.id, { name: "A", isPrimary: true });
    const b = await createClientContact(fixtures.orgA.id, client.id, { name: "B" });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await setPrimaryContactAction(client.id, b.contact.id);

    const bAfter = await prisma.clientContact.findUniqueOrThrow({ where: { id: b.contact.id } });
    expect(bAfter.isPrimary).toBe(true);
    const aAfter = await prisma.clientContact.findUniqueOrThrow({ where: { id: a.contact.id } });
    expect(aAfter.isPrimary).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Security (18-23)
  // ---------------------------------------------------------------------

  it("18/23. a foreign-org actor cannot create a contact on another org's Client — the crafted clientId simply doesn't resolve", async () => {
    const foreignClient = await makeClient(fixtures.orgB.id, fixtures.orgBOwner.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await createContactAction(foreignClient.id, { error: null }, buildContactFormData({ name: "Should not exist" }));

    expect(result).toEqual({ error: "Client not found." });
    expect(await prisma.clientContact.count({ where: { clientId: foreignClient.id } })).toBe(0);
  });

  it("19. a foreign-org actor cannot edit another org's contact", async () => {
    const client = await makeClient(fixtures.orgB.id, fixtures.orgBOwner.id);
    const contact = await createClientContact(fixtures.orgB.id, client.id, { name: "OrgB Contact" });
    if (!contact.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateContactAction(
      contact.contact.id,
      client.id,
      { error: null },
      buildContactFormData({ name: "Hijacked" }),
    );

    expect(result).toEqual({ error: "Contact not found." });
    const unchanged = await prisma.clientContact.findUniqueOrThrow({ where: { id: contact.contact.id } });
    expect(unchanged.name).toBe("OrgB Contact");
  });

  it("20. a foreign-org actor cannot archive another org's contact", async () => {
    const client = await makeClient(fixtures.orgB.id, fixtures.orgBOwner.id);
    const contact = await createClientContact(fixtures.orgB.id, client.id, { name: "OrgB Contact" });
    if (!contact.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await expect(archiveContactAction(contact.contact.id, client.id)).rejects.toThrow("Contact not found.");

    const unchanged = await prisma.clientContact.findUniqueOrThrow({ where: { id: contact.contact.id } });
    expect(unchanged.archivedAt).toBeNull();
  });

  it("21. a foreign-org actor cannot unarchive another org's contact", async () => {
    const client = await makeClient(fixtures.orgB.id, fixtures.orgBOwner.id);
    const contact = await createClientContact(fixtures.orgB.id, client.id, { name: "OrgB Contact" });
    if (!contact.ok) throw new Error("expected ok");
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    await archiveContactAction(contact.contact.id, client.id);
    resetAuthMock();

    actAs(fixtures.owner, fixtures.orgA.id);
    await expect(unarchiveContactAction(contact.contact.id, client.id)).rejects.toThrow("Contact not found.");

    const unchanged = await prisma.clientContact.findUniqueOrThrow({ where: { id: contact.contact.id } });
    expect(unchanged.archivedAt).not.toBeNull();
  });

  it("22. a foreign-org actor cannot set another org's contact as primary", async () => {
    const client = await makeClient(fixtures.orgB.id, fixtures.orgBOwner.id);
    const contact = await createClientContact(fixtures.orgB.id, client.id, { name: "OrgB Contact" });
    if (!contact.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await expect(setPrimaryContactAction(client.id, contact.contact.id)).rejects.toThrow("Contact not found.");

    const unchanged = await prisma.clientContact.findUniqueOrThrow({ where: { id: contact.contact.id } });
    expect(unchanged.isPrimary).toBe(false);
  });

  it("23. a crafted clientId cannot be used to re-parent a contact via setPrimaryContactAction — a contactId belonging to a DIFFERENT Client in the SAME org is still rejected", async () => {
    const clientA = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const clientB = await makeClient(fixtures.orgA.id, fixtures.owner.id);
    const contactOnB = await createClientContact(fixtures.orgA.id, clientB.id, { name: "Belongs to B" });
    if (!contactOnB.ok) throw new Error("expected ok");
    actAs(fixtures.owner, fixtures.orgA.id);

    await expect(setPrimaryContactAction(clientA.id, contactOnB.contact.id)).rejects.toThrow(
      "Contact not found.",
    );

    const unchanged = await prisma.clientContact.findUniqueOrThrow({ where: { id: contactOnB.contact.id } });
    expect(unchanged.clientId).toBe(clientB.id);
    expect(unchanged.isPrimary).toBe(false);
  });
});
