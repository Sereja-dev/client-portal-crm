import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listOrganizationClientRequests,
  getOrganizationClientRequest,
  updateClientRequestStatus,
  updateClientRequestPriority,
  assignClientRequest,
  linkClientRequestProject,
  archiveClientRequest,
  unarchiveClientRequest,
  type ClientRequestActor,
} from "@/lib/client-requests/staff";
import { createPortalClientRequest } from "@/lib/client-requests/portal";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Client Requests / Tickets, Phase 1 — Staff domain layer (test items 6,
 * 7, 8, 9, 10, 11, 19-26, 28). Domain functions here take organizationId
 * and an explicit `actor: {id, name}` directly, never resolve a session
 * themselves — see portal.test.ts's own identical header comment.
 */

async function cleanupRequests(organizationIds: string[]) {
  await prisma.clientRequest.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

describe("Client Requests — Staff domain layer", () => {
  let fixtures: TestFixtures;
  let ownerActor: ClientRequestActor;

  async function createRequest(clientId = fixtures.clientA.id) {
    const result = await createPortalClientRequest(
      { organizationId: fixtures.orgA.id, clientId, portalUserId: fixtures.portalUser.id, portalUserName: "Portal User" },
      { title: "Site is down", description: "Nothing loads." },
    );
    if (!result.ok) throw new Error("expected ok");
    return result.request;
  }

  beforeAll(async () => {
    fixtures = await seedTestData();
    ownerActor = { id: fixtures.owner.id, name: fixtures.owner.name };
  });

  afterEach(async () => {
    await cleanupRequests([fixtures.orgA.id, fixtures.orgB.id]);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("6. Staff can list their own organization's requests", async () => {
    const a = await createRequest(fixtures.clientA.id);
    await prisma.$transaction(async (tx) => {
      await tx.clientRequest.create({
        data: { organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, title: "Org B", description: "D" },
      });
    });

    const list = await listOrganizationClientRequests(fixtures.orgA.id);
    expect(list.map((r) => r.id)).toEqual([a.id]);
  });

  it("7a. Staff cannot read another org's request — getOrganizationClientRequest returns null", async () => {
    const orgBRequest = await prisma.clientRequest.create({
      data: { organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, title: "Org B", description: "D" },
    });

    const result = await getOrganizationClientRequest(fixtures.orgA.id, orgBRequest.id);
    expect(result).toBeNull();
  });

  it("7b. Staff cannot update another org's request — every mutator returns REQUEST_NOT_FOUND, and nothing is persisted", async () => {
    const orgBRequest = await prisma.clientRequest.create({
      data: { organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, title: "Org B", description: "D" },
    });

    const statusResult = await updateClientRequestStatus(fixtures.orgA.id, orgBRequest.id, "IN_PROGRESS", ownerActor);
    expect(statusResult).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" });

    const priorityResult = await updateClientRequestPriority(fixtures.orgA.id, orgBRequest.id, "HIGH", ownerActor);
    expect(priorityResult).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" });

    const assignResult = await assignClientRequest(fixtures.orgA.id, orgBRequest.id, fixtures.owner.id, ownerActor);
    expect(assignResult).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" });

    const archiveResult = await archiveClientRequest(fixtures.orgA.id, orgBRequest.id);
    expect(archiveResult).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" });

    const stillOriginal = await prisma.clientRequest.findUniqueOrThrow({ where: { id: orgBRequest.id } });
    expect(stillOriginal.status).toBe("OPEN");
    expect(stillOriginal.priority).toBe("NORMAL");
    expect(stillOriginal.assignedToId).toBeNull();
    expect(stillOriginal.archivedAt).toBeNull();
  });

  describe("status transitions", () => {
    it("19. OPEN -> IN_PROGRESS", async () => {
      const request = await createRequest();
      const result = await updateClientRequestStatus(fixtures.orgA.id, request.id, "IN_PROGRESS", ownerActor);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.request.status).toBe("IN_PROGRESS");

      const activity = await prisma.activity.findFirst({ where: { entityType: "CLIENT_REQUEST", entityId: request.id, action: "STATUS_CHANGED" } });
      expect(activity).not.toBeNull();
      expect(activity!.actorId).toBe(fixtures.owner.id);
    });

    it("20. sets WAITING_ON_CLIENT", async () => {
      const request = await createRequest();
      const result = await updateClientRequestStatus(fixtures.orgA.id, request.id, "WAITING_ON_CLIENT", ownerActor);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.request.status).toBe("WAITING_ON_CLIENT");
    });

    it("21. RESOLVED sets resolvedAt; CLOSED afterward preserves it; reopening to OPEN clears it", async () => {
      const request = await createRequest();

      const resolved = await updateClientRequestStatus(fixtures.orgA.id, request.id, "RESOLVED", ownerActor);
      if (!resolved.ok) throw new Error("expected ok");
      expect(resolved.request.resolvedAt).not.toBeNull();
      const resolvedAt = resolved.request.resolvedAt;

      const closed = await updateClientRequestStatus(fixtures.orgA.id, request.id, "CLOSED", ownerActor);
      if (!closed.ok) throw new Error("expected ok");
      expect(closed.request.status).toBe("CLOSED");
      expect(closed.request.resolvedAt?.getTime()).toBe(resolvedAt?.getTime());

      const reopened = await updateClientRequestStatus(fixtures.orgA.id, request.id, "OPEN", ownerActor);
      if (!reopened.ok) throw new Error("expected ok");
      expect(reopened.request.resolvedAt).toBeNull();
    });

    it("22. an invalid status value is rejected, and persists nothing", async () => {
      const request = await createRequest();
      const result = await updateClientRequestStatus(fixtures.orgA.id, request.id, "DELETED", ownerActor);
      expect(result).toEqual({ ok: false, reason: "INVALID_STATUS" });

      const stillOriginal = await prisma.clientRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(stillOriginal.status).toBe("OPEN");
    });

    it("re-saving the same status is a no-op — idempotent, no duplicate Activity row", async () => {
      const request = await createRequest();
      await updateClientRequestStatus(fixtures.orgA.id, request.id, "IN_PROGRESS", ownerActor);
      await updateClientRequestStatus(fixtures.orgA.id, request.id, "IN_PROGRESS", ownerActor);

      const count = await prisma.activity.count({ where: { entityType: "CLIENT_REQUEST", entityId: request.id, action: "STATUS_CHANGED" } });
      expect(count).toBe(1);
    });
  });

  describe("priority", () => {
    it("23. a priority update works, Staff can set URGENT", async () => {
      const request = await createRequest();
      const result = await updateClientRequestPriority(fixtures.orgA.id, request.id, "URGENT", ownerActor);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.request.priority).toBe("URGENT");
    });

    it("24. an invalid priority value is rejected, and persists nothing", async () => {
      const request = await createRequest();
      const result = await updateClientRequestPriority(fixtures.orgA.id, request.id, "CRITICAL", ownerActor);
      expect(result).toEqual({ ok: false, reason: "INVALID_PRIORITY" });

      const stillOriginal = await prisma.clientRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(stillOriginal.priority).toBe("NORMAL");
    });
  });

  describe("assignment", () => {
    it("10. an assignee must belong to the same organization — a valid Membership succeeds", async () => {
      const request = await createRequest();
      const result = await assignClientRequest(fixtures.orgA.id, request.id, fixtures.admin.id, ownerActor);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.request.assignedToId).toBe(fixtures.admin.id);
    });

    it("11. a cross-org assignee (no Membership in this organization) is rejected, and persists nothing", async () => {
      const request = await createRequest();
      const result = await assignClientRequest(fixtures.orgA.id, request.id, fixtures.orgBOwner.id, ownerActor);
      expect(result).toEqual({ ok: false, reason: "INVALID_ASSIGNEE" });

      const stillOriginal = await prisma.clientRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(stillOriginal.assignedToId).toBeNull();
    });

    it("assigning null unassigns", async () => {
      const request = await createRequest();
      await assignClientRequest(fixtures.orgA.id, request.id, fixtures.admin.id, ownerActor);
      const result = await assignClientRequest(fixtures.orgA.id, request.id, null, ownerActor);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.request.assignedToId).toBeNull();
    });
  });

  describe("project link", () => {
    it("8/9. linking a Project requires the same organization AND the same Client as the request", async () => {
      const request = await createRequest(fixtures.clientA.id);
      const result = await linkClientRequestProject(fixtures.orgA.id, request.id, fixtures.project.id, ownerActor);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.request.projectId).toBe(fixtures.project.id);
    });

    it("9. a cross-org Project is rejected", async () => {
      const orgBProject = await prisma.project.create({
        data: { name: "Org B Project", clientId: fixtures.clientB.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id, status: "PLANNING" },
      });
      const request = await createRequest(fixtures.clientA.id);

      const result = await linkClientRequestProject(fixtures.orgA.id, request.id, orgBProject.id, ownerActor);
      expect(result).toEqual({ ok: false, reason: "INVALID_PROJECT" });

      await prisma.project.deleteMany({ where: { id: orgBProject.id } });
    });

    it("28. no cross-org orphan relation can be created: an org-B assignee AND an org-B project are both rejected for the same org-A request", async () => {
      const request = await createRequest(fixtures.clientA.id);

      await assignClientRequest(fixtures.orgA.id, request.id, fixtures.orgBOwner.id, ownerActor);
      const orgBProject = await prisma.project.create({
        data: { name: "Org B Project", clientId: fixtures.clientB.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id, status: "PLANNING" },
      });
      await linkClientRequestProject(fixtures.orgA.id, request.id, orgBProject.id, ownerActor);

      const stillClean = await prisma.clientRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(stillClean.assignedToId).toBeNull();
      expect(stillClean.projectId).toBeNull();

      await prisma.project.deleteMany({ where: { id: orgBProject.id } });
    });

    it("unlinking (null) always succeeds", async () => {
      const request = await createRequest(fixtures.clientA.id);
      await linkClientRequestProject(fixtures.orgA.id, request.id, fixtures.project.id, ownerActor);
      const result = await linkClientRequestProject(fixtures.orgA.id, request.id, null, ownerActor);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.request.projectId).toBeNull();
    });
  });

  describe("25/26. archive/unarchive", () => {
    it("archives and unarchives, idempotently", async () => {
      const request = await createRequest();

      const archived = await archiveClientRequest(fixtures.orgA.id, request.id);
      expect(archived.ok).toBe(true);
      if (!archived.ok) throw new Error("expected ok");
      expect(archived.request.archivedAt).not.toBeNull();

      const stillArchived = await archiveClientRequest(fixtures.orgA.id, request.id);
      expect(stillArchived.ok).toBe(true);
      if (!stillArchived.ok) throw new Error("expected ok");
      expect(stillArchived.request.archivedAt?.getTime()).toBe(archived.request.archivedAt?.getTime());

      const unarchived = await unarchiveClientRequest(fixtures.orgA.id, request.id);
      expect(unarchived.ok).toBe(true);
      if (!unarchived.ok) throw new Error("expected ok");
      expect(unarchived.request.archivedAt).toBeNull();
    });

    it("26. an archived request is excluded from listOrganizationClientRequests by default, included with includeArchived", async () => {
      const request = await createRequest();
      await archiveClientRequest(fixtures.orgA.id, request.id);

      const activeOnly = await listOrganizationClientRequests(fixtures.orgA.id);
      expect(activeOnly.map((r) => r.id)).not.toContain(request.id);

      const withArchived = await listOrganizationClientRequests(fixtures.orgA.id, { includeArchived: true });
      expect(withArchived.map((r) => r.id)).toContain(request.id);
    });

    it("26. an archived request is still readable directly via getOrganizationClientRequest", async () => {
      const request = await createRequest();
      await archiveClientRequest(fixtures.orgA.id, request.id);

      const found = await getOrganizationClientRequest(fixtures.orgA.id, request.id);
      expect(found?.archivedAt).not.toBeNull();
    });

    it("cross-org staff cannot unarchive another org's request", async () => {
      const orgBRequest = await prisma.clientRequest.create({
        data: { organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, title: "Org B", description: "D", archivedAt: new Date() },
      });

      const result = await unarchiveClientRequest(fixtures.orgA.id, orgBRequest.id);
      expect(result).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" });

      const stillArchived = await prisma.clientRequest.findUniqueOrThrow({ where: { id: orgBRequest.id } });
      expect(stillArchived.archivedAt).not.toBeNull();
    });
  });
});
