import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Client Requests / Tickets, Phase 1 — migration/cascade coverage (test
 * item 27). Every scenario here builds its own small, fully disposable
 * rows (never fixtures.owner/fixtures.clientA/fixtures.portalUser
 * themselves) specifically so a real hard-delete inside one test can
 * never affect another test — or this file's own afterAll cleanup.
 */
describe("Client Requests — cascade/delete behavior", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("deleting a Client cascades to delete its ClientRequests, and their Messages with them", async () => {
    const client = await prisma.client.create({ data: { name: "Cascade Client", organizationId: fixtures.orgA.id, userId: fixtures.owner.id } });
    const request = await prisma.clientRequest.create({ data: { organizationId: fixtures.orgA.id, clientId: client.id, title: "T", description: "D" } });
    const message = await prisma.clientRequestMessage.create({
      data: { organizationId: fixtures.orgA.id, requestId: request.id, authorType: "STAFF", staffUserId: fixtures.owner.id, body: "Hi" },
    });

    await prisma.client.delete({ where: { id: client.id } });

    expect(await prisma.clientRequest.findUnique({ where: { id: request.id } })).toBeNull();
    expect(await prisma.clientRequestMessage.findUnique({ where: { id: message.id } })).toBeNull();
  });

  it("deleting an Organization cascades to delete its ClientRequests and Messages", async () => {
    const org = await prisma.organization.create({ data: { name: "Cascade Org", slug: `cascade-org-${randomUUID()}` } });
    const user = await prisma.user.create({ data: { id: randomUUID(), email: `cascade-owner-${randomUUID()}@example.com`, name: "Cascade Owner" } });
    const client = await prisma.client.create({ data: { name: "Cascade Client", organizationId: org.id, userId: user.id } });
    const request = await prisma.clientRequest.create({ data: { organizationId: org.id, clientId: client.id, title: "T", description: "D" } });
    const message = await prisma.clientRequestMessage.create({
      data: { organizationId: org.id, requestId: request.id, authorType: "STAFF", staffUserId: user.id, body: "Hi" },
    });

    await prisma.organization.delete({ where: { id: org.id } });

    expect(await prisma.clientRequest.findUnique({ where: { id: request.id } })).toBeNull();
    expect(await prisma.clientRequestMessage.findUnique({ where: { id: message.id } })).toBeNull();

    // Client.organizationId is onDelete: SetNull (not Cascade) — the
    // Client row itself survives the Organization delete (orphaned, just
    // organizationId: null), and still holds a Restrict FK on userId, so
    // it must be cleaned up before the temp User can be deleted.
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  it("deleting a PortalUser sets ClientRequest.portalUserId and ClientRequestMessage.portalUserId to null, never deletes either row", async () => {
    const client = await prisma.client.create({ data: { name: "Cascade Client", organizationId: fixtures.orgA.id, userId: fixtures.owner.id } });
    const portalUser = await prisma.portalUser.create({
      data: { id: randomUUID(), clientId: client.id, email: `cascade-portal-${randomUUID()}@example.com`, name: "Cascade Portal User" },
    });
    const request = await prisma.clientRequest.create({
      data: { organizationId: fixtures.orgA.id, clientId: client.id, portalUserId: portalUser.id, title: "T", description: "D" },
    });
    const message = await prisma.clientRequestMessage.create({
      data: { organizationId: fixtures.orgA.id, requestId: request.id, authorType: "PORTAL", portalUserId: portalUser.id, body: "Hi" },
    });

    await prisma.portalUser.delete({ where: { id: portalUser.id } });

    const survivingRequest = await prisma.clientRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(survivingRequest.portalUserId).toBeNull();
    const survivingMessage = await prisma.clientRequestMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(survivingMessage.portalUserId).toBeNull();

    await prisma.clientRequest.deleteMany({ where: { id: request.id } });
    await prisma.client.deleteMany({ where: { id: client.id } });
  });

  it("deleting a User sets ClientRequest.assignedToId and ClientRequestMessage.staffUserId to null, never deletes either row", async () => {
    const user = await prisma.user.create({ data: { id: randomUUID(), email: `cascade-assignee-${randomUUID()}@example.com`, name: "Cascade Assignee" } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: fixtures.orgA.id, role: "MEMBER" } });
    const request = await prisma.clientRequest.create({
      data: { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, assignedToId: user.id, title: "T", description: "D" },
    });
    const message = await prisma.clientRequestMessage.create({
      data: { organizationId: fixtures.orgA.id, requestId: request.id, authorType: "STAFF", staffUserId: user.id, body: "Hi" },
    });

    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });

    const survivingRequest = await prisma.clientRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(survivingRequest.assignedToId).toBeNull();
    const survivingMessage = await prisma.clientRequestMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(survivingMessage.staffUserId).toBeNull();

    await prisma.clientRequest.deleteMany({ where: { id: request.id } });
  });

  it("deleting a Project sets ClientRequest.projectId to null, never deletes the request", async () => {
    const project = await prisma.project.create({
      data: { name: "Cascade Project", clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id, status: "PLANNING" },
    });
    const request = await prisma.clientRequest.create({
      data: { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, projectId: project.id, title: "T", description: "D" },
    });

    await prisma.project.delete({ where: { id: project.id } });

    const survivingRequest = await prisma.clientRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(survivingRequest.projectId).toBeNull();

    await prisma.clientRequest.deleteMany({ where: { id: request.id } });
  });
});
