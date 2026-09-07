import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createClientAction } from "@/app/(dashboard)/clients/new/actions";
import { updateClientAction } from "@/app/(dashboard)/clients/[id]/edit/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

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
