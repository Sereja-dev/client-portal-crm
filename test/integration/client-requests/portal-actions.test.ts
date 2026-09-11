import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createPortalClientRequestAction, addPortalClientRequestMessageAction } from "@/app/portal/(app)/requests/actions";
import * as portalRequestActions from "@/app/portal/(app)/requests/actions";
import { createPortalClientRequest } from "@/lib/client-requests/portal";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { setMockAuthUser, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * Client Requests / Tickets Phase 2A — Portal Server Action layer (test
 * items 2, 3, 7, 8, 9, 10). Mirrors
 * test/integration/quotes/portal-decision.test.ts's own
 * setMockAuthUser(portalUser) pattern for exercising an authenticated
 * Portal Server Action directly.
 */

async function expectRedirect(promise: Promise<unknown>): Promise<RedirectSignal> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
  return caught as RedirectSignal;
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

async function cleanupRequests(organizationIds: string[]) {
  await prisma.clientRequest.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

describe("Client Requests — Portal Server Actions", () => {
  let fixtures: TestFixtures;
  let clientA2Id: string;
  let portalUserA2Id: string;

  function actAsPortal(portalUserId = fixtures.portalUser.id, email = fixtures.portalUser.email) {
    setMockAuthUser({ id: portalUserId, email });
  }

  beforeAll(async () => {
    fixtures = await seedTestData();
    const clientA2 = await prisma.client.create({
      data: { name: "Test Client A2", organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    clientA2Id = clientA2.id;
    const portalUserA2 = await prisma.portalUser.create({
      data: { id: randomUUID(), clientId: clientA2Id, email: `portal-a2-${randomUUID()}@example.com`, name: "Test Portal User A2" },
    });
    portalUserA2Id = portalUserA2.id;
  });

  afterEach(async () => {
    await cleanupRequests([fixtures.orgA.id, fixtures.orgB.id]);
    resetAuthMock();
  });

  afterAll(async () => {
    await prisma.portalUser.deleteMany({ where: { id: portalUserA2Id } });
    await prisma.client.deleteMany({ where: { id: clientA2Id } });
    await cleanupTestData(fixtures);
  });

  it("9. the Portal actions module exposes exactly create + add-message — no status/priority/assign/project-link/archive action exists on the Portal side at all", () => {
    const exportedNames = Object.keys(portalRequestActions).sort();
    expect(exportedNames).toEqual(["addPortalClientRequestMessageAction", "createPortalClientRequestAction"]);
  });

  it("2. Portal create works end to end via the Server Action", async () => {
    actAsPortal();
    const redirect = await expectRedirect(
      createPortalClientRequestAction({ error: null }, formData({ title: "Site is down", description: "Nothing loads.", priority: "HIGH" })),
    );
    expect(redirect.url).toContain("/portal/requests/");

    const created = await prisma.clientRequest.findFirstOrThrow({ where: { title: "Site is down" } });
    expect(created.clientId).toBe(fixtures.clientA.id);
    expect(created.organizationId).toBe(fixtures.orgA.id);
    expect(created.status).toBe("OPEN");
    expect(created.priority).toBe("HIGH");
  });

  it("3. Portal create never trusts a client-supplied clientId/organizationId — always the authenticated Portal identity's own", async () => {
    actAsPortal();
    const forged = formData({ title: "Attacker", description: "Body" });
    forged.set("clientId", clientA2Id);
    forged.set("organizationId", fixtures.orgB.id);

    await expectRedirect(createPortalClientRequestAction({ error: null }, forged));

    const created = await prisma.clientRequest.findFirstOrThrow({ where: { title: "Attacker" } });
    expect(created.clientId).toBe(fixtures.clientA.id);
    expect(created.organizationId).toBe(fixtures.orgA.id);
  });

  it("10. Portal create rejects URGENT priority at the Server Action layer", async () => {
    actAsPortal();
    const result = await createPortalClientRequestAction({ error: null }, formData({ title: "T", description: "D", priority: "URGENT" }));
    expect(result.fieldErrors?.priority).toBeTruthy();
    expect(await prisma.clientRequest.count({ where: { title: "T", clientId: fixtures.clientA.id } })).toBe(0);
  });

  it("7. Portal can add a message to their own request via the Server Action", async () => {
    const created = await createPortalClientRequest(
      { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, portalUserId: fixtures.portalUser.id, portalUserName: "Portal User" },
      { title: "T", description: "D" },
    );
    if (!created.ok) throw new Error("expected ok");

    actAsPortal();
    const result = await addPortalClientRequestMessageAction(created.request.id, { error: null }, formData({ body: "Any update?" }));
    expect(result).toEqual({ error: null });

    const message = await prisma.clientRequestMessage.findFirstOrThrow({ where: { requestId: created.request.id } });
    expect(message.body).toBe("Any update?");
    expect(message.authorType).toBe("PORTAL");
    expect(message.portalUserId).toBe(fixtures.portalUser.id);
  });

  it("8. Portal cannot add a message to another Client's request via the Server Action", async () => {
    const created = await createPortalClientRequest(
      { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, portalUserId: fixtures.portalUser.id, portalUserName: "Portal User" },
      { title: "T", description: "D" },
    );
    if (!created.ok) throw new Error("expected ok");

    actAsPortal(portalUserA2Id, `portal-a2-lookup-${randomUUID()}@example.com`);
    const result = await addPortalClientRequestMessageAction(created.request.id, { error: null }, formData({ body: "Not my ticket" }));
    expect(result.error).toBeTruthy();
    expect(await prisma.clientRequestMessage.count({ where: { requestId: created.request.id } })).toBe(0);
  });

  it("26. an empty message is rejected by the Portal Server Action, and creates nothing", async () => {
    const created = await createPortalClientRequest(
      { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, portalUserId: fixtures.portalUser.id, portalUserName: "Portal User" },
      { title: "T", description: "D" },
    );
    if (!created.ok) throw new Error("expected ok");

    actAsPortal();
    const result = await addPortalClientRequestMessageAction(created.request.id, { error: null }, formData({ body: "   " }));
    expect(result.error).toBeTruthy();
    expect(await prisma.clientRequestMessage.count({ where: { requestId: created.request.id } })).toBe(0);
  });
});
