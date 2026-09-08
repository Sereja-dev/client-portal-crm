import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createClientAction } from "@/app/(dashboard)/clients/new/actions";
import { createClientContact } from "@/lib/clients/contacts";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

// Multiple Contacts Phase 1, item 16 — same real module-mocking technique
// already established in test/integration/invoices/activity-atomicity.
// test.ts (wrap the real implementation in vi.fn(), force one rejected
// call in a single test). Wraps the ACTUAL implementation by default, so
// every other test in this file (including the pre-existing
// duplicate-email suite above) calls straight through unchanged.
vi.mock("@/lib/clients/contacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/contacts")>();
  return { ...actual, createClientContact: vi.fn(actual.createClientContact) };
});

/**
 * Leads / Sales Pipeline Phase 2.2 — createClientAction's own duplicate-
 * email behavior after removing the legacy Client @@unique([userId,
 * email]) constraint (see the Client Email Uniqueness audit). Manual
 * Client creation is now blocked by an application-level check
 * (findDuplicateOrganizationClientByEmail, src/lib/clients/
 * duplicate-email.ts) rather than a database P2002 — same
 * organization, case-insensitive, deliberately with no "create anyway"
 * path (unlike Lead conversion's own confirmDuplicate flow).
 */

const NAME_PREFIX = "Client-Create";

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

describe("createClientAction — duplicate email (Phase 2.2)", () => {
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

  it("1. a unique email succeeds", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    await expectRedirect(createClientAction({ error: null }, buildClientFormData({ name, email: `${name}@example.com` })));

    const created = await prisma.client.findFirst({ where: { name } });
    expect(created).not.toBeNull();
  });

  it("2. a same-organization duplicate normalized email is blocked, and creates nothing", async () => {
    const email = `dup-${randomUUID().slice(0, 8)}@example.com`;
    actAs(fixtures.owner, fixtures.orgA.id);
    const firstName = uniqueName();
    await expectRedirect(createClientAction({ error: null }, buildClientFormData({ name: firstName, email })));

    const secondName = uniqueName();
    const result = await createClientAction({ error: null }, buildClientFormData({ name: secondName, email }));

    expect(result).toEqual({ error: null, fieldErrors: { email: "A client with this email already exists." } });
    expect(await prisma.client.findFirst({ where: { name: secondName } })).toBeNull();
  });

  it("3. the duplicate check is case-insensitive", async () => {
    const email = `case-${randomUUID().slice(0, 8)}@example.com`;
    actAs(fixtures.owner, fixtures.orgA.id);
    const firstName = uniqueName();
    await expectRedirect(createClientAction({ error: null }, buildClientFormData({ name: firstName, email: email.toUpperCase() })));

    const secondName = uniqueName();
    const result = await createClientAction({ error: null }, buildClientFormData({ name: secondName, email: email.toLowerCase() }));

    expect(result).toMatchObject({ fieldErrors: { email: expect.any(String) } });
  });

  it("4. the duplicate check trims for comparison", async () => {
    const email = `trim-${randomUUID().slice(0, 8)}@example.com`;
    actAs(fixtures.owner, fixtures.orgA.id);
    const firstName = uniqueName();
    await expectRedirect(createClientAction({ error: null }, buildClientFormData({ name: firstName, email })));

    const secondName = uniqueName();
    const result = await createClientAction({ error: null }, buildClientFormData({ name: secondName, email: `  ${email}  ` }));

    expect(result).toMatchObject({ fieldErrors: { email: expect.any(String) } });
  });

  it("5. the same email in a different organization is allowed", async () => {
    const email = `cross-org-${randomUUID().slice(0, 8)}@example.com`;
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const orgBName = uniqueName();
    await expectRedirect(createClientAction({ error: null }, buildClientFormData({ name: orgBName, email })));
    resetAuthMock();

    actAs(fixtures.owner, fixtures.orgA.id);
    const orgAName = uniqueName();
    await expectRedirect(createClientAction({ error: null }, buildClientFormData({ name: orgAName, email })));

    expect(await prisma.client.findFirst({ where: { name: orgAName } })).not.toBeNull();
  });

  it("6. a null (omitted) email is always allowed, even repeatedly", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const nameA = uniqueName();
    const nameB = uniqueName();

    await expectRedirect(createClientAction({ error: null }, buildClientFormData({ name: nameA })));
    await expectRedirect(createClientAction({ error: null }, buildClientFormData({ name: nameB })));

    expect(await prisma.client.findFirst({ where: { name: nameA } })).not.toBeNull();
    expect(await prisma.client.findFirst({ where: { name: nameB } })).not.toBeNull();
  });

  it("7. two different staff owners in the same organization cannot bypass the duplicate warning", async () => {
    const email = `two-owners-${randomUUID().slice(0, 8)}@example.com`;
    actAs(fixtures.owner, fixtures.orgA.id);
    const firstName = uniqueName();
    await expectRedirect(createClientAction({ error: null }, buildClientFormData({ name: firstName, email })));
    resetAuthMock();

    // A DIFFERENT staff member, same organization — the old
    // @@unique([userId, email]) constraint would have let this through
    // (different userId); the new organization-scoped application check
    // correctly still blocks it.
    actAs(fixtures.admin, fixtures.orgA.id);
    const secondName = uniqueName();
    const result = await createClientAction({ error: null }, buildClientFormData({ name: secondName, email }));

    expect(result).toEqual({ error: null, fieldErrors: { email: "A client with this email already exists." } });
    expect(await prisma.client.findFirst({ where: { name: secondName } })).toBeNull();
  });

  it("8. an attacker-supplied organizationId field has no effect on the resolved scope", async () => {
    actAs(fixtures.member, fixtures.orgA.id);
    const name = uniqueName();

    await expectRedirect(
      createClientAction({ error: null }, buildClientFormData({ name, organizationId: fixtures.orgB.id })),
    );

    const created = await prisma.client.findFirstOrThrow({ where: { name } });
    expect(created.organizationId).toBe(fixtures.orgA.id);
  });
});

/**
 * Multiple Contacts Phase 1 — items 14/15/16 of that feature's own test
 * plan. createClientAction itself is otherwise completely unchanged (see
 * the duplicate-email suite above, all still passing unmodified) — this
 * only covers the new, additive primary-ClientContact creation.
 */
describe("createClientAction — primary ClientContact creation (Multiple Contacts Phase 1)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  it("14/15. a Client created with an email gets exactly one primary ClientContact, atomically, with the email-local-part fallback name", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    await expectRedirect(
      createClientAction({ error: null }, buildClientFormData({ name, email: `contact-${name}@example.com` })),
    );

    const client = await prisma.client.findFirstOrThrow({ where: { name } });
    const contacts = await prisma.clientContact.findMany({ where: { clientId: client.id } });
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      isPrimary: true,
      archivedAt: null,
      email: `contact-${name}@example.com`,
      name: `contact-${name}`,
      organizationId: fixtures.orgA.id,
    });
    // Client.name itself is never copied onto the contact's own name.
    expect(contacts[0].name).not.toBe(name);
  });

  it("a Client created with only a phone (no email) gets a primary ClientContact with the 'Primary Contact' fallback name", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    await expectRedirect(createClientAction({ error: null }, buildClientFormData({ name, phone: "555-0100" })));

    const client = await prisma.client.findFirstOrThrow({ where: { name } });
    const contact = await prisma.clientContact.findFirstOrThrow({ where: { clientId: client.id } });
    expect(contact.name).toBe("Primary Contact");
    expect(contact.phone).toBe("555-0100");
    expect(contact.email).toBeNull();
    expect(contact.isPrimary).toBe(true);
  });

  it("a Client created with neither email nor phone gets no ClientContact at all — conservative, not one per Client unconditionally", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    await expectRedirect(createClientAction({ error: null }, buildClientFormData({ name })));

    const client = await prisma.client.findFirstOrThrow({ where: { name } });
    const contacts = await prisma.clientContact.findMany({ where: { clientId: client.id } });
    expect(contacts).toHaveLength(0);
  });

  it("16. rollback: a forced ClientContact-creation failure rolls back the whole Client create — no Client, no Activity, no partial contact", async () => {
    vi.mocked(createClientContact).mockRejectedValueOnce(new Error("simulated ClientContact creation failure"));

    actAs(fixtures.owner, fixtures.orgA.id);
    const name = uniqueName();

    let caught: unknown;
    try {
      await createClientAction({ error: null }, buildClientFormData({ name, email: `rollback-${name}@example.com` }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect(caught).not.toBeInstanceOf(RedirectSignal);

    const client = await prisma.client.findFirst({ where: { name } });
    expect(client).toBeNull();
    const activity = await prisma.activity.findFirst({ where: { metadata: { path: ["name"], equals: name } } });
    expect(activity).toBeNull();
  });
});
