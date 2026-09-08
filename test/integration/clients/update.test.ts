import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createClientAction } from "@/app/(dashboard)/clients/new/actions";
import { updateClientAction } from "@/app/(dashboard)/clients/[id]/edit/actions";
import { updateClientContact, syncPrimaryContactEmailFromClientEdit } from "@/lib/clients/contacts";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

// Multiple Contacts Phase 1, "Close Legacy Email Sync Gap" item 6 — same
// real module-mocking technique already established in test/integration/
// invoices/activity-atomicity.test.ts and test/integration/clients/
// create.test.ts's own rollback test (wrap the real implementation in
// vi.fn(), force one rejected call in a single test). Wraps the ACTUAL
// implementation by default, so every other test in this file calls
// straight through unchanged.
vi.mock("@/lib/clients/contacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/contacts")>();
  return { ...actual, syncPrimaryContactEmailFromClientEdit: vi.fn(actual.syncPrimaryContactEmailFromClientEdit) };
});

/**
 * Leads / Sales Pipeline Phase 2.2 — updateClientAction's own duplicate-
 * email behavior after removing the legacy Client @@unique([userId,
 * email]) constraint. Same-organization, case-insensitive,
 * self-excluding (editing a Client to keep its own current email must
 * never self-conflict).
 */

const NAME_PREFIX = "Client-Update";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

function buildClientFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

async function expectRedirect(promise: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
}

async function createClient(orgId: string, actor: { id: string; email: string; name: string }, email?: string) {
  const name = uniqueName();
  actAs(actor, orgId);
  await expectRedirect(createClientAction({ error: null }, buildClientFormData(email ? { name, email } : { name })));
  resetAuthMock();
  return prisma.client.findFirstOrThrow({ where: { name } });
}

describe("updateClientAction — duplicate email (Phase 2.2)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  it("9. changing to a unique email succeeds", async () => {
    const client = await createClient(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);
    const newEmail = `new-${randomUUID().slice(0, 8)}@example.com`;

    await expectRedirect(updateClientAction(client.id, { error: null }, buildClientFormData({ name: client.name, email: newEmail })));

    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).email).toBe(newEmail);
  });

  it("10. keeping your own existing email succeeds (never self-conflicts)", async () => {
    const email = `self-${randomUUID().slice(0, 8)}@example.com`;
    const client = await createClient(fixtures.orgA.id, fixtures.owner, email);
    actAs(fixtures.owner, fixtures.orgA.id);

    // A real redirect (success), never the duplicate-email validation error.
    await expectRedirect(updateClientAction(client.id, { error: null }, buildClientFormData({ name: client.name, email })));

    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).email).toBe(email);
  });

  it("11. changing to another same-org Client's email is blocked", async () => {
    const email = `taken-${randomUUID().slice(0, 8)}@example.com`;
    await createClient(fixtures.orgA.id, fixtures.owner, email);
    resetAuthMock();
    const clientToEdit = await createClient(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateClientAction(clientToEdit.id, { error: null }, buildClientFormData({ name: clientToEdit.name, email }));

    expect(result).toEqual({ error: null, fieldErrors: { email: "A client with this email already exists." } });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: clientToEdit.id } })).email).toBeNull();
  });

  it("12. a case-insensitive duplicate is blocked", async () => {
    const email = `case-upd-${randomUUID().slice(0, 8)}@example.com`;
    await createClient(fixtures.orgA.id, fixtures.owner, email);
    resetAuthMock();
    const clientToEdit = await createClient(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateClientAction(
      clientToEdit.id,
      { error: null },
      buildClientFormData({ name: clientToEdit.name, email: email.toUpperCase() }),
    );

    expect(result).toMatchObject({ fieldErrors: { email: expect.any(String) } });
  });

  it("13. a matching email in a different organization is allowed", async () => {
    const email = `cross-org-upd-${randomUUID().slice(0, 8)}@example.com`;
    await createClient(fixtures.orgB.id, fixtures.orgBOwner, email);
    resetAuthMock();
    const clientToEdit = await createClient(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(
      updateClientAction(clientToEdit.id, { error: null }, buildClientFormData({ name: clientToEdit.name, email })),
    );

    expect((await prisma.client.findUniqueOrThrow({ where: { id: clientToEdit.id } })).email).toBe(email);
  });

  it("14. changing the email to null (clearing it) succeeds", async () => {
    const email = `clearing-${randomUUID().slice(0, 8)}@example.com`;
    const client = await createClient(fixtures.orgA.id, fixtures.owner, email);
    actAs(fixtures.owner, fixtures.orgA.id);

    await expectRedirect(updateClientAction(client.id, { error: null }, buildClientFormData({ name: client.name })));

    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).email).toBeNull();
  });

  it("15. a Client owned by a different staff member in the same org still triggers the duplicate check", async () => {
    const email = `diff-owner-${randomUUID().slice(0, 8)}@example.com`;
    await createClient(fixtures.orgA.id, fixtures.admin, email);
    resetAuthMock();
    // clientToEdit is owned by `owner` — a different userId than the
    // existing duplicate-email Client (owned by `admin`). The old
    // @@unique([userId, email]) would never have caught this cross-owner
    // case at all; the new organization-scoped check does.
    const clientToEdit = await createClient(fixtures.orgA.id, fixtures.owner);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateClientAction(clientToEdit.id, { error: null }, buildClientFormData({ name: clientToEdit.name, email }));

    expect(result).toEqual({ error: null, fieldErrors: { email: "A client with this email already exists." } });
  });

  it("a foreign-org edit is still a quiet not-found, unaffected by the duplicate-email change", async () => {
    actAs(fixtures.orgBOwner, fixtures.orgB.id);

    const result = await updateClientAction(
      fixtures.clientA.id,
      { error: null },
      buildClientFormData({ name: fixtures.clientA.name, email: "should-not-apply@example.com" }),
    );

    expect(result).toEqual({ error: "This client could not be found." });
  });
});

/**
 * Multiple Contacts Phase 1, items 17/18 of that feature's own test plan
 * — updated by the "Close Legacy Email Sync Gap" follow-up. Editing
 * Client.email through this existing form is now bidirectionally
 * compatible with the active primary contact (see
 * syncPrimaryContactEmailFromClientEdit's own comment in
 * src/lib/clients/contacts.ts for the full rule): both directions
 * ("primary contact -> Client.email", covered by contacts.test.ts, and
 * "Client.email edit -> primary contact", covered here) now hold. Every
 * other test in this file (the duplicate-email suite above) is
 * completely unaffected — this follow-up changes nothing about
 * validation, ownership scoping, or the duplicate-email check.
 */
describe("updateClientAction — ClientContact compatibility (Multiple Contacts Phase 1, incl. Close Legacy Email Sync Gap)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  it("17. editing a Client's name/email through the existing form still works exactly as before, with a primary contact already present", async () => {
    const originalEmail = `original-${randomUUID().slice(0, 8)}@example.com`;
    const client = await createClient(fixtures.orgA.id, fixtures.owner, originalEmail);
    actAs(fixtures.owner, fixtures.orgA.id);
    const newName = uniqueName();

    await expectRedirect(
      updateClientAction(client.id, { error: null }, buildClientFormData({ name: newName, email: originalEmail })),
    );

    const updated = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(updated.name).toBe(newName);
    expect(updated.email).toBe(originalEmail);
  });

  it("1. editing Client.email old -> new through the existing form updates the active primary ClientContact's own email to match, atomically", async () => {
    const originalEmail = `before-${randomUUID().slice(0, 8)}@example.com`;
    const client = await createClient(fixtures.orgA.id, fixtures.owner, originalEmail);
    const contactBefore = await prisma.clientContact.findFirstOrThrow({ where: { clientId: client.id, isPrimary: true } });
    expect(contactBefore.email).toBe(originalEmail);

    actAs(fixtures.owner, fixtures.orgA.id);
    const newEmail = `after-${randomUUID().slice(0, 8)}@example.com`;
    await expectRedirect(updateClientAction(client.id, { error: null }, buildClientFormData({ name: client.name, email: newEmail })));

    const updatedClient = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(updatedClient.email).toBe(newEmail);

    // The primary contact's own email now follows Client.email — the gap
    // this follow-up closes.
    const contactAfter = await prisma.clientContact.findUniqueOrThrow({ where: { id: contactBefore.id } });
    expect(contactAfter.email).toBe(newEmail);
  });

  it("2. re-saving the SAME Client.email leaves the primary contact's updatedAt untouched — no unnecessary contact mutation", async () => {
    const email = `unchanged-${randomUUID().slice(0, 8)}@example.com`;
    const client = await createClient(fixtures.orgA.id, fixtures.owner, email);
    const contactBefore = await prisma.clientContact.findFirstOrThrow({ where: { clientId: client.id, isPrimary: true } });

    actAs(fixtures.owner, fixtures.orgA.id);
    await expectRedirect(updateClientAction(client.id, { error: null }, buildClientFormData({ name: client.name, email })));

    const contactAfter = await prisma.clientContact.findUniqueOrThrow({ where: { id: contactBefore.id } });
    expect(contactAfter.email).toBe(email);
    expect(contactAfter.updatedAt.getTime()).toBe(contactBefore.updatedAt.getTime());
  });

  it("4a. explicitly clearing Client.email (old -> empty) also clears the primary contact's own email — the chosen compatibility rule", async () => {
    const originalEmail = `clear-${randomUUID().slice(0, 8)}@example.com`;
    const client = await createClient(fixtures.orgA.id, fixtures.owner, originalEmail);
    actAs(fixtures.owner, fixtures.orgA.id);

    // parseClientForm turns an empty submitted field into null before it
    // ever reaches this action or its sync helper — there is no separate
    // "empty string" state at the data layer, only "null".
    await expectRedirect(updateClientAction(client.id, { error: null }, buildClientFormData({ name: client.name, email: "" })));

    const updatedClient = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(updatedClient.email).toBeNull();

    const contact = await prisma.clientContact.findFirstOrThrow({ where: { clientId: client.id, isPrimary: true } });
    expect(contact.email).toBeNull();
  });

  it("3. a Client with no primary contact still updates its email successfully, with no error and nothing created", async () => {
    const client = await createClient(fixtures.orgA.id, fixtures.owner); // no email at create time -> no contact created at all
    expect(await prisma.clientContact.count({ where: { clientId: client.id } })).toBe(0);

    actAs(fixtures.owner, fixtures.orgA.id);
    const newEmail = `no-contact-${randomUUID().slice(0, 8)}@example.com`;
    await expectRedirect(updateClientAction(client.id, { error: null }, buildClientFormData({ name: client.name, email: newEmail })));

    const updatedClient = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(updatedClient.email).toBe(newEmail);
    expect(await prisma.clientContact.count({ where: { clientId: client.id } })).toBe(0);
  });

  it("8. an archived former-primary contact is never re-synchronized by a Client.email edit", async () => {
    const originalEmail = `archived-${randomUUID().slice(0, 8)}@example.com`;
    const client = await createClient(fixtures.orgA.id, fixtures.owner, originalEmail);
    const contact = await prisma.clientContact.findFirstOrThrow({ where: { clientId: client.id, isPrimary: true } });
    await prisma.clientContact.update({ where: { id: contact.id }, data: { archivedAt: new Date() } });

    actAs(fixtures.owner, fixtures.orgA.id);
    const newEmail = `archived-new-${randomUUID().slice(0, 8)}@example.com`;
    await expectRedirect(updateClientAction(client.id, { error: null }, buildClientFormData({ name: client.name, email: newEmail })));

    const updatedClient = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(updatedClient.email).toBe(newEmail);

    // The archived contact's own email is left exactly as it was —
    // Section Q's own "archiving leaves no primary, no auto-promotion"
    // rule means there is nothing active for this edit to touch.
    const archivedAfter = await prisma.clientContact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(archivedAfter.email).toBe(originalEmail);
  });

  it("8b. a non-primary (secondary) contact is never synchronized by a Client.email edit", async () => {
    const originalEmail = `secondary-${randomUUID().slice(0, 8)}@example.com`;
    const client = await createClient(fixtures.orgA.id, fixtures.owner, originalEmail);
    const secondary = await prisma.clientContact.create({
      data: { organizationId: fixtures.orgA.id, clientId: client.id, name: "Secondary", email: "secondary@example.com" },
    });

    actAs(fixtures.owner, fixtures.orgA.id);
    const newEmail = `secondary-new-${randomUUID().slice(0, 8)}@example.com`;
    await expectRedirect(updateClientAction(client.id, { error: null }, buildClientFormData({ name: client.name, email: newEmail })));

    const secondaryAfter = await prisma.clientContact.findUniqueOrThrow({ where: { id: secondary.id } });
    expect(secondaryAfter.email).toBe("secondary@example.com");
  });

  it("7. the forward direction still works after this follow-up — updating the primary contact's own email still synchronizes Client.email", async () => {
    const client = await createClient(fixtures.orgA.id, fixtures.owner, `fwd-${randomUUID().slice(0, 8)}@example.com`);
    const contact = await prisma.clientContact.findFirstOrThrow({ where: { clientId: client.id, isPrimary: true } });

    const newContactEmail = `fwd-new-${randomUUID().slice(0, 8)}@example.com`;
    const result = await updateClientContact(fixtures.orgA.id, contact.id, { email: newContactEmail });
    expect(result.ok).toBe(true);

    const clientAfter = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(clientAfter.email).toBe(newContactEmail);
  });

  it("5. duplicate-Client-email validation is completely unaffected by this follow-up — still blocked, still creates/changes nothing", async () => {
    const email = `dup-sync-${randomUUID().slice(0, 8)}@example.com`;
    await createClient(fixtures.orgA.id, fixtures.owner, email);
    resetAuthMock();
    const clientToEdit = await createClient(fixtures.orgA.id, fixtures.owner, `other-${randomUUID().slice(0, 8)}@example.com`);
    const contactBefore = await prisma.clientContact.findFirstOrThrow({ where: { clientId: clientToEdit.id, isPrimary: true } });

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await updateClientAction(clientToEdit.id, { error: null }, buildClientFormData({ name: clientToEdit.name, email }));

    expect(result).toEqual({ error: null, fieldErrors: { email: "A client with this email already exists." } });
    // Blocked before the transaction ever opens — the primary contact's
    // own email is untouched.
    const contactAfter = await prisma.clientContact.findUniqueOrThrow({ where: { id: contactBefore.id } });
    expect(contactAfter.email).toBe(contactBefore.email);
  });

  it("4/6. cross-org scoping is unaffected — a foreign-org edit remains a quiet not-found, and syncs nothing", async () => {
    const client = await createClient(fixtures.orgA.id, fixtures.owner, `crossorg-${randomUUID().slice(0, 8)}@example.com`);
    const contactBefore = await prisma.clientContact.findFirstOrThrow({ where: { clientId: client.id, isPrimary: true } });

    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const result = await updateClientAction(client.id, { error: null }, buildClientFormData({ name: client.name, email: "should-not-apply@example.com" }));

    expect(result).toEqual({ error: "This client could not be found." });
    const contactAfter = await prisma.clientContact.findUniqueOrThrow({ where: { id: contactBefore.id } });
    expect(contactAfter.email).toBe(contactBefore.email);
  });

  it("6. rollback: a forced primary-contact sync failure rolls back the whole Client update — neither the Client's email nor the contact's own email change", async () => {
    const originalEmail = `rollback-${randomUUID().slice(0, 8)}@example.com`;
    const client = await createClient(fixtures.orgA.id, fixtures.owner, originalEmail);
    const contactBefore = await prisma.clientContact.findFirstOrThrow({ where: { clientId: client.id, isPrimary: true } });

    actAs(fixtures.owner, fixtures.orgA.id);
    vi.mocked(syncPrimaryContactEmailFromClientEdit).mockRejectedValueOnce(new Error("simulated sync failure"));

    const newEmail = `rollback-new-${randomUUID().slice(0, 8)}@example.com`;
    let caught: unknown;
    try {
      await updateClientAction(client.id, { error: null }, buildClientFormData({ name: client.name, email: newEmail }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();

    const clientAfter = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(clientAfter.email).toBe(originalEmail);
    const contactAfter = await prisma.clientContact.findUniqueOrThrow({ where: { id: contactBefore.id } });
    expect(contactAfter.email).toBe(originalEmail);
  });
});
