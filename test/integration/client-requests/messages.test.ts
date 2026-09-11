import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  addStaffClientRequestMessage,
  addPortalClientRequestMessage,
  listClientRequestMessagesForOrganization,
  listClientRequestMessagesForClient,
} from "@/lib/client-requests/messages";
import { createPortalClientRequest } from "@/lib/client-requests/portal";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Client Requests / Tickets, Phase 1 — the conversation domain layer
 * (test items 13-18). Author integrity (item 17) is checked directly
 * against the persisted row's own authorType/staffUserId/portalUserId
 * columns, not just the function's return value.
 */

async function cleanupRequests(organizationIds: string[]) {
  // ClientRequestMessage cascades from ClientRequest, which cascades from
  // Organization/Client — one deleteMany covers both.
  await prisma.clientRequest.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

describe("Client Requests — messages", () => {
  let fixtures: TestFixtures;
  let clientA2Id: string;
  let portalUserA2Id: string;

  async function createRequest(clientId = fixtures.clientA.id, portalUserId = fixtures.portalUser.id) {
    const result = await createPortalClientRequest(
      { organizationId: fixtures.orgA.id, clientId, portalUserId, portalUserName: "Portal User" },
      { title: "Site is down", description: "Nothing loads." },
    );
    if (!result.ok) throw new Error("expected ok");
    return result.request;
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

  it("13. Portal can add a message to their own Client's request", async () => {
    const request = await createRequest();
    const result = await addPortalClientRequestMessage(fixtures.clientA.id, request.id, fixtures.portalUser.id, "Any update on this?");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.message.body).toBe("Any update on this?");
    expect(result.message.requestId).toBe(request.id);
    expect(result.message.organizationId).toBe(fixtures.orgA.id);
  });

  it("14a. Portal cannot message another Client's request (same org)", async () => {
    const request = await createRequest(fixtures.clientA.id);
    const result = await addPortalClientRequestMessage(clientA2Id, request.id, portalUserA2Id, "Trying to read someone else's ticket");
    expect(result).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" });
    expect(await prisma.clientRequestMessage.count({ where: { requestId: request.id } })).toBe(0);
  });

  it("14b. Portal cannot message another Client's request (different org)", async () => {
    const request = await createRequest(fixtures.clientA.id);
    const result = await addPortalClientRequestMessage(fixtures.clientB.id, request.id, "nonexistent-portal-user-in-org-b", "Cross-org attempt");
    expect(result).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" });
  });

  it("15. Staff can add a message to their own organization's request", async () => {
    const request = await createRequest();
    const result = await addStaffClientRequestMessage(fixtures.orgA.id, request.id, fixtures.owner.id, "We're looking into it.");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.message.body).toBe("We're looking into it.");
  });

  it("16. Staff cannot message another organization's request", async () => {
    const orgBRequest = await prisma.clientRequest.create({
      data: { organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, title: "Org B", description: "D" },
    });

    const result = await addStaffClientRequestMessage(fixtures.orgA.id, orgBRequest.id, fixtures.owner.id, "Cross-org attempt");
    expect(result).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" });
  });

  it("17a. message author integrity: a Staff message always stores authorType STAFF with staffUserId set and portalUserId null", async () => {
    const request = await createRequest();
    const result = await addStaffClientRequestMessage(fixtures.orgA.id, request.id, fixtures.owner.id, "Staff reply");
    if (!result.ok) throw new Error("expected ok");

    const persisted = await prisma.clientRequestMessage.findUniqueOrThrow({ where: { id: result.message.id } });
    expect(persisted.authorType).toBe("STAFF");
    expect(persisted.staffUserId).toBe(fixtures.owner.id);
    expect(persisted.portalUserId).toBeNull();
  });

  it("17b. message author integrity: a Portal message always stores authorType PORTAL with portalUserId set and staffUserId null", async () => {
    const request = await createRequest();
    const result = await addPortalClientRequestMessage(fixtures.clientA.id, request.id, fixtures.portalUser.id, "Portal reply");
    if (!result.ok) throw new Error("expected ok");

    const persisted = await prisma.clientRequestMessage.findUniqueOrThrow({ where: { id: result.message.id } });
    expect(persisted.authorType).toBe("PORTAL");
    expect(persisted.portalUserId).toBe(fixtures.portalUser.id);
    expect(persisted.staffUserId).toBeNull();
  });

  it("17c. a Staff author must independently hold a real Membership in this organization", async () => {
    const request = await createRequest();
    const result = await addStaffClientRequestMessage(fixtures.orgA.id, request.id, fixtures.orgBOwner.id, "Not a member of org A");
    expect(result).toEqual({ ok: false, reason: "INVALID_AUTHOR" });
  });

  it("17d. a Portal author must independently belong to this exact Client", async () => {
    const request = await createRequest(fixtures.clientA.id);
    const result = await addPortalClientRequestMessage(fixtures.clientA.id, request.id, portalUserA2Id, "Wrong client's portal user");
    expect(result).toEqual({ ok: false, reason: "INVALID_AUTHOR" });
  });

  it("18a. an empty (whitespace-only) Staff message is rejected", async () => {
    const request = await createRequest();
    const result = await addStaffClientRequestMessage(fixtures.orgA.id, request.id, fixtures.owner.id, "    ");
    expect(result).toEqual({ ok: false, reason: "VALIDATION", error: "empty" });
    expect(await prisma.clientRequestMessage.count({ where: { requestId: request.id } })).toBe(0);
  });

  it("18b. an empty (whitespace-only) Portal message is rejected", async () => {
    const request = await createRequest();
    const result = await addPortalClientRequestMessage(fixtures.clientA.id, request.id, fixtures.portalUser.id, "");
    expect(result).toEqual({ ok: false, reason: "VALIDATION", error: "empty" });
  });

  it("listClientRequestMessagesForOrganization/ForClient both return messages in chronological order, and null for a foreign request", async () => {
    const request = await createRequest();
    await addPortalClientRequestMessage(fixtures.clientA.id, request.id, fixtures.portalUser.id, "First");
    await addStaffClientRequestMessage(fixtures.orgA.id, request.id, fixtures.owner.id, "Second");

    const forStaff = await listClientRequestMessagesForOrganization(fixtures.orgA.id, request.id);
    expect(forStaff?.map((m) => m.body)).toEqual(["First", "Second"]);

    const forPortal = await listClientRequestMessagesForClient(fixtures.clientA.id, request.id);
    expect(forPortal?.map((m) => m.body)).toEqual(["First", "Second"]);

    expect(await listClientRequestMessagesForOrganization(fixtures.orgB.id, request.id)).toBeNull();
    expect(await listClientRequestMessagesForClient(clientA2Id, request.id)).toBeNull();
  });
});
