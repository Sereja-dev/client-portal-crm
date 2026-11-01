import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createClientAction } from "@/app/(dashboard)/clients/new/actions";
import { resolveClientPrefill } from "@/lib/clients/resolve-prefill";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

// First-Time User Experience V2, Slice A. After a successful ordinary Staff
// Client creation the action redirects to the NEW Client Profile
// (/clients/<id>) — not the global list — keeping the "Client created"
// toast; the Profile's "Create project" action then links to
// /projects/new?clientId=<id>, which the Project form resolves through
// resolveClientPrefill (organization-scoped). Real database; the
// authenticated identity is the only thing mocked.

const PREFIX = "Client-Redirect";
const unique = () => `${PREFIX}-${randomUUID().slice(0, 8)}`;

let fixtures: TestFixtures;
let orgAStatusId: string;
let orgBStatusId: string;

function form(fields: Record<string, string>, statusDefinitionId: string): FormData {
  const formData = new FormData();
  formData.set("statusDefinitionId", statusDefinitionId);
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
  return (caught as RedirectSignal).url;
}

beforeAll(async () => {
  fixtures = await seedTestData();
  await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
  await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgB.id);
  const lead = (organizationId: string) =>
    prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId, entityType: "CLIENT", isSystem: true, key: "lead" },
    });
  orgAStatusId = (await lead(fixtures.orgA.id)).id;
  orgBStatusId = (await lead(fixtures.orgB.id)).id;
});

afterEach(() => {
  resetAuthMock();
});

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await cleanupTestData(fixtures);
});

describe("createClientAction — success redirect", () => {
  it("lands on the new Client Profile with the 'Client created' toast, using the persisted client id", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = unique();

    const url = await redirectOf(createClientAction({ error: null }, form({ name }, orgAStatusId)));

    const created = await prisma.client.findFirstOrThrow({ where: { name } });
    const parsed = new URL(url, "http://localhost");
    expect(parsed.pathname).toBe(`/clients/${created.id}`);
    expect(parsed.searchParams.get("toast")).toBe("Client created");
    expect(parsed.pathname).not.toBe("/clients");
  });

  it("creates exactly one Client — the redirect adds no duplicate", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = unique();

    await redirectOf(createClientAction({ error: null }, form({ name }, orgAStatusId)));

    expect(await prisma.client.count({ where: { name } })).toBe(1);
  });

  it("the redirect target belongs to the acting organization (tenant isolation)", async () => {
    const nameA = unique();
    const nameB = unique();

    actAs(fixtures.owner, fixtures.orgA.id);
    const urlA = await redirectOf(createClientAction({ error: null }, form({ name: nameA }, orgAStatusId)));
    resetAuthMock();
    actAs(fixtures.orgBOwner, fixtures.orgB.id);
    const urlB = await redirectOf(createClientAction({ error: null }, form({ name: nameB }, orgBStatusId)));

    const a = await prisma.client.findFirstOrThrow({ where: { name: nameA } });
    const b = await prisma.client.findFirstOrThrow({ where: { name: nameB } });
    expect(a.organizationId).toBe(fixtures.orgA.id);
    expect(b.organizationId).toBe(fixtures.orgB.id);
    expect(new URL(urlA, "http://localhost").pathname).toBe(`/clients/${a.id}`);
    expect(new URL(urlB, "http://localhost").pathname).toBe(`/clients/${b.id}`);
    expect(urlA).not.toContain(b.id);
    expect(urlB).not.toContain(a.id);
  });
});

describe("createClientAction — failures still do not redirect", () => {
  it("a validation failure returns field errors, creates no Client and does not redirect", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const before = await prisma.client.count({ where: { organizationId: fixtures.orgA.id } });

    const result = await createClientAction({ error: null }, form({ name: "" }, orgAStatusId));

    expect(result.fieldErrors).toBeDefined();
    expect(await prisma.client.count({ where: { organizationId: fixtures.orgA.id } })).toBe(before);
  });

  it("a duplicate email returns its field error, does not redirect and creates no second Client", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const email = `redirect-${randomUUID().slice(0, 8)}@example.com`;
    const first = unique();
    await redirectOf(createClientAction({ error: null }, form({ name: first, email }, orgAStatusId)));

    const second = unique();
    const result = await createClientAction({ error: null }, form({ name: second, email }, orgAStatusId));

    expect(result.fieldErrors?.email).toBe("A client with this email already exists.");
    expect(await prisma.client.count({ where: { name: second } })).toBe(0);
    expect(await prisma.client.count({ where: { name: first } })).toBe(1);
  });
});

describe("Project form client prefill from the new Client Profile", () => {
  it("resolves the new client for its own organization, so /projects/new?clientId=<id> preselects it", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = unique();
    await redirectOf(createClientAction({ error: null }, form({ name }, orgAStatusId)));
    const created = await prisma.client.findFirstOrThrow({ where: { name } });

    expect(await resolveClientPrefill(fixtures.orgA.id, created.id)).toEqual({ id: created.id, name });
  });

  it("never resolves another organization's client, or a malformed id", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const name = unique();
    await redirectOf(createClientAction({ error: null }, form({ name }, orgAStatusId)));
    const created = await prisma.client.findFirstOrThrow({ where: { name } });

    expect(await resolveClientPrefill(fixtures.orgB.id, created.id)).toBeNull();
    expect(await resolveClientPrefill(fixtures.orgA.id, "not-a-uuid")).toBeNull();
    expect(await resolveClientPrefill(fixtures.orgA.id, "")).toBeNull();
  });
});
