import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createClientAction } from "@/app/(dashboard)/clients/new/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

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
