import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createPortalClientRequest, listPortalClientRequests, getPortalClientRequest, type PortalClientRequestContext } from "@/lib/client-requests/portal";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Client Requests / Tickets, Phase 1 — Portal domain layer (test items 1,
 * 2, 3, 4, 5, 12). Domain functions here take a plain `context` object,
 * never resolve a session themselves (no Server Action/UI layer exists
 * yet in this phase) — so these are exercised directly, the same way
 * Custom Statuses Phase 1's own domain layer was, with no auth mocking
 * needed at all.
 */

async function cleanupRequests(organizationIds: string[]) {
  // ClientRequestMessage/ClientRequest both cascade from Client/Organization
  // — explicit cleanup here only matters for ad-hoc extra fixtures this
  // file creates beyond seedTestData()'s own orgA/orgB/clientA/clientB.
  await prisma.clientRequest.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

describe("Client Requests — Portal domain layer", () => {
  let fixtures: TestFixtures;
  // A second Client within orgA (same organization as fixtures.clientA,
  // fixtures.portalUser), with its own PortalUser — needed for "another
  // Client" isolation tests that a cross-ORG client (fixtures.clientB)
  // alone can't distinguish from a cross-CLIENT-same-org case.
  let clientA2Id: string;
  let portalUserA2Id: string;

  function contextFor(clientId: string, portalUserId: string, portalUserName = "Portal User"): PortalClientRequestContext {
    return { organizationId: fixtures.orgA.id, clientId, portalUserId, portalUserName };
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
  });

  afterAll(async () => {
    await prisma.portalUser.deleteMany({ where: { id: portalUserA2Id } });
    await prisma.client.deleteMany({ where: { id: clientA2Id } });
    await cleanupTestData(fixtures);
  });

  it("1/2/3/4. a Portal user creates a request for their own Client: OPEN, priority NORMAL, org/client derived from context, real PortalUser creator stored", async () => {
    const result = await createPortalClientRequest(contextFor(fixtures.clientA.id, fixtures.portalUser.id, fixtures.portalUser.name), {
      title: "Site is down",
      description: "The homepage returns a 500 error.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.request.status).toBe("OPEN");
    expect(result.request.priority).toBe("NORMAL");
    expect(result.request.organizationId).toBe(fixtures.orgA.id);
    expect(result.request.clientId).toBe(fixtures.clientA.id);
    expect(result.request.portalUserId).toBe(fixtures.portalUser.id);
    expect(result.request.assignedToId).toBeNull();

    const activity = await prisma.activity.findFirst({
      where: { entityType: "CLIENT_REQUEST", entityId: result.request.id, action: "CREATED" },
    });
    expect(activity).not.toBeNull();
    expect(activity!.actorId).toBeNull();
  });

  it("createPortalClientRequest never trusts organizationId/clientId/assignedToId from the input payload, even if a caller tries to smuggle them in", async () => {
    const maliciousInput = {
      title: "Attacker",
      description: "Body",
      organizationId: fixtures.orgB.id,
      clientId: clientA2Id,
      assignedToId: fixtures.owner.id,
      status: "RESOLVED",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await createPortalClientRequest(contextFor(fixtures.clientA.id, fixtures.portalUser.id), maliciousInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.request.organizationId).toBe(fixtures.orgA.id);
    expect(result.request.clientId).toBe(fixtures.clientA.id);
    expect(result.request.assignedToId).toBeNull();
    expect(result.request.status).toBe("OPEN");
  });

  it("5a. a Portal user cannot read a request belonging to another Client in the SAME organization", async () => {
    const created = await createPortalClientRequest(contextFor(fixtures.clientA.id, fixtures.portalUser.id), { title: "T", description: "D" });
    if (!created.ok) throw new Error("expected ok");

    const fromOtherClient = await getPortalClientRequest(clientA2Id, created.request.id);
    expect(fromOtherClient).toBeNull();
  });

  it("5b. a Portal user cannot read a request belonging to another Client in a DIFFERENT organization", async () => {
    const created = await createPortalClientRequest(contextFor(fixtures.clientA.id, fixtures.portalUser.id), { title: "T", description: "D" });
    if (!created.ok) throw new Error("expected ok");

    const fromOtherOrgClient = await getPortalClientRequest(fixtures.clientB.id, created.request.id);
    expect(fromOtherOrgClient).toBeNull();
  });

  it("5c. a Portal user's own request list never includes another Client's requests, same org or not", async () => {
    const ownRequest = await createPortalClientRequest(contextFor(fixtures.clientA.id, fixtures.portalUser.id), { title: "Mine", description: "D" });
    const otherSameOrgClientRequest = await createPortalClientRequest(contextFor(clientA2Id, portalUserA2Id), { title: "Not mine (same org)", description: "D" });
    if (!ownRequest.ok || !otherSameOrgClientRequest.ok) throw new Error("expected ok");

    const list = await listPortalClientRequests(fixtures.clientA.id);
    expect(list.map((r) => r.id)).toEqual([ownRequest.request.id]);
    expect(list.map((r) => r.id)).not.toContain(otherSameOrgClientRequest.request.id);
  });

  it("required-field enforcement: blank title/description is rejected, and creates no row", async () => {
    const before = await prisma.clientRequest.count({ where: { clientId: fixtures.clientA.id } });

    const result = await createPortalClientRequest(contextFor(fixtures.clientA.id, fixtures.portalUser.id), { title: "   ", description: "Body" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("VALIDATION");

    expect(await prisma.clientRequest.count({ where: { clientId: fixtures.clientA.id } })).toBe(before);
  });

  it("Portal priority is restricted to LOW/NORMAL/HIGH — URGENT is rejected", async () => {
    const result = await createPortalClientRequest(contextFor(fixtures.clientA.id, fixtures.portalUser.id), {
      title: "T",
      description: "D",
      priority: "URGENT",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("VALIDATION");
  });

  it("Portal can select LOW/NORMAL/HIGH", async () => {
    const result = await createPortalClientRequest(contextFor(fixtures.clientA.id, fixtures.portalUser.id), {
      title: "T",
      description: "D",
      priority: "HIGH",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.request.priority).toBe("HIGH");
  });

  it("8/9. an optional Project link requires the same organization AND the same Client — a same-org, different-client Project is rejected", async () => {
    const projectOnOtherClient = await prisma.project.create({
      data: { name: "Other Client Project", clientId: clientA2Id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "PLANNING" },
    });

    const result = await createPortalClientRequest(contextFor(fixtures.clientA.id, fixtures.portalUser.id), {
      title: "T",
      description: "D",
      projectId: projectOnOtherClient.id,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("INVALID_PROJECT");

    await prisma.project.deleteMany({ where: { id: projectOnOtherClient.id } });
  });

  it("8. a Project belonging to the same organization AND the same Client links successfully", async () => {
    const result = await createPortalClientRequest(contextFor(fixtures.clientA.id, fixtures.portalUser.id), {
      title: "T",
      description: "D",
      projectId: fixtures.project.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.request.projectId).toBe(fixtures.project.id);
  });

  it("17. a not-found response (getPortalClientRequest) never leaks whether the request exists in another Client/org — same null either way", async () => {
    const genuinelyMissing = await getPortalClientRequest(fixtures.clientA.id, "00000000-0000-0000-0000-000000000000");
    const created = await createPortalClientRequest(contextFor(clientA2Id, portalUserA2Id), { title: "T", description: "D" });
    if (!created.ok) throw new Error("expected ok");
    const wrongClient = await getPortalClientRequest(fixtures.clientA.id, created.request.id);

    expect(genuinelyMissing).toBeNull();
    expect(wrongClient).toBeNull();
  });
});
