import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createPortalClientRequest } from "@/lib/client-requests/portal";
import { bulkUpdateClientRequestStatusAction, bulkAssignClientRequestAction } from "@/app/(dashboard)/requests/bulk-actions";
import { BULK_SELECTION_MAX } from "@/lib/bulk-actions/shared";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Tables Improvement Slice C — Support Requests' two approved V1 bulk
 * actions (status change, assignment), via the exact Server Actions the
 * Active list's own BulkActionBar calls. Mirrors
 * test/integration/client-requests/staff-actions.test.ts's own
 * seedTestData/actAs/createRequest pattern exactly.
 */
describe("Client Requests — bulk status/assignment (Tables Improvement Slice C)", () => {
  let fixtures: TestFixtures;

  async function createRequest(clientId = fixtures.clientA.id, organizationId = fixtures.orgA.id) {
    const result = await createPortalClientRequest(
      { organizationId, clientId, portalUserId: fixtures.portalUser.id, portalUserName: "Portal User" },
      { title: "Site is down", description: "Nothing loads." },
    );
    if (!result.ok) throw new Error("expected ok");
    return result.request;
  }

  async function cleanupRequests(organizationIds: string[]) {
    await prisma.clientRequest.deleteMany({ where: { organizationId: { in: organizationIds } } });
  }

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupRequests([fixtures.orgA.id, fixtures.orgB.id]);
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  describe("bulk status update", () => {
    it("updates multiple selected Requests' status in one call, through the exact existing updateClientRequestStatus() path, including its Activity/resolvedAt side effects", async () => {
      const a = await createRequest();
      const b = await createRequest();
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await bulkUpdateClientRequestStatusAction([a.id, b.id], "RESOLVED");
      expect(result).toEqual({ updatedCount: 2, failedCount: 0, failures: [] });

      const refreshedA = await prisma.clientRequest.findUniqueOrThrow({ where: { id: a.id } });
      const refreshedB = await prisma.clientRequest.findUniqueOrThrow({ where: { id: b.id } });
      expect(refreshedA.status).toBe("RESOLVED");
      expect(refreshedA.resolvedAt).not.toBeNull();
      expect(refreshedB.status).toBe("RESOLVED");

      const activityA = await prisma.activity.findFirst({
        where: { entityType: "CLIENT_REQUEST", entityId: a.id, action: "STATUS_CHANGED" },
      });
      expect(activityA?.actorId).toBe(fixtures.owner.id);
    });

    it("an invalid status fails every selected row with INVALID_STATUS, before any row is mutated", async () => {
      const a = await createRequest();
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await bulkUpdateClientRequestStatusAction([a.id], "NOT_A_REAL_STATUS");
      expect(result).toEqual({ updatedCount: 0, failedCount: 1, failures: [{ id: a.id, reason: "INVALID_STATUS" }] });

      const refreshed = await prisma.clientRequest.findUniqueOrThrow({ where: { id: a.id } });
      expect(refreshed.status).toBe("OPEN");
    });

    it("mixed valid + stale id: the valid row updates, the stale one fails on its own (partial success)", async () => {
      const valid = await createRequest();
      const staleId = crypto.randomUUID();
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await bulkUpdateClientRequestStatusAction([valid.id, staleId], "IN_PROGRESS");
      expect(result.updatedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.failures).toEqual([{ id: staleId, reason: "REQUEST_NOT_FOUND" }]);
    });

    it("organization isolation: a foreign-org Request id fails with REQUEST_NOT_FOUND, never leaking that it exists, and is never mutated", async () => {
      const foreign = await createRequest(fixtures.clientB.id, fixtures.orgB.id);
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await bulkUpdateClientRequestStatusAction([foreign.id], "CLOSED");
      expect(result).toEqual({ updatedCount: 0, failedCount: 1, failures: [{ id: foreign.id, reason: "REQUEST_NOT_FOUND" }] });

      const refreshed = await prisma.clientRequest.findUniqueOrThrow({ where: { id: foreign.id } });
      expect(refreshed.status).toBe("OPEN");
    });
  });

  describe("bulk assignment", () => {
    it("assigns multiple selected Requests to a valid same-organization member in one call, through the exact existing assignClientRequest() path", async () => {
      const a = await createRequest();
      const b = await createRequest();
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await bulkAssignClientRequestAction([a.id, b.id], fixtures.admin.id);
      expect(result).toEqual({ updatedCount: 2, failedCount: 0, failures: [] });

      const refreshedA = await prisma.clientRequest.findUniqueOrThrow({ where: { id: a.id } });
      expect(refreshedA.assignedToId).toBe(fixtures.admin.id);
    });

    it("assigns to Unassigned (null) -- the same optional-unassign the existing single-record UI already supports", async () => {
      const a = await createRequest();
      actAs(fixtures.owner, fixtures.orgA.id);
      await bulkAssignClientRequestAction([a.id], fixtures.admin.id);

      const result = await bulkAssignClientRequestAction([a.id], null);
      expect(result).toEqual({ updatedCount: 1, failedCount: 0, failures: [] });
      const refreshed = await prisma.clientRequest.findUniqueOrThrow({ where: { id: a.id } });
      expect(refreshed.assignedToId).toBeNull();
    });

    it("a foreign/ineligible assignee (no Membership in this organization) fails every selected row with INVALID_ASSIGNEE, before any row is mutated", async () => {
      const a = await createRequest();
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await bulkAssignClientRequestAction([a.id], fixtures.orgBOwner.id);
      expect(result).toEqual({ updatedCount: 0, failedCount: 1, failures: [{ id: a.id, reason: "INVALID_ASSIGNEE" }] });

      const refreshed = await prisma.clientRequest.findUniqueOrThrow({ where: { id: a.id } });
      expect(refreshed.assignedToId).toBeNull();
    });

    it("mixed valid + stale id: the valid row is assigned, the stale one fails on its own (partial success)", async () => {
      const valid = await createRequest();
      const staleId = crypto.randomUUID();
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await bulkAssignClientRequestAction([valid.id, staleId], fixtures.admin.id);
      expect(result.updatedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.failures).toEqual([{ id: staleId, reason: "REQUEST_NOT_FOUND" }]);
    });

    it("organization isolation: a foreign-org Request id fails with REQUEST_NOT_FOUND, and is never assigned", async () => {
      const foreign = await createRequest(fixtures.clientB.id, fixtures.orgB.id);
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await bulkAssignClientRequestAction([foreign.id], fixtures.admin.id);
      expect(result).toEqual({ updatedCount: 0, failedCount: 1, failures: [{ id: foreign.id, reason: "REQUEST_NOT_FOUND" }] });
    });
  });

  describe("selection cap (shared across both actions)", () => {
    it(`accepts exactly ${BULK_SELECTION_MAX} ids`, async () => {
      const requests = await Promise.all(Array.from({ length: BULK_SELECTION_MAX }, () => createRequest()));
      actAs(fixtures.owner, fixtures.orgA.id);

      const result = await bulkUpdateClientRequestStatusAction(requests.map((r) => r.id), "IN_PROGRESS");
      expect(result.updatedCount).toBe(BULK_SELECTION_MAX);
      expect(result.failedCount).toBe(0);
    });

    it(`rejects a selection larger than ${BULK_SELECTION_MAX} safely, for both actions -- zero rows mutated`, async () => {
      const tooMany = Array.from({ length: BULK_SELECTION_MAX + 1 }, () => crypto.randomUUID());
      actAs(fixtures.owner, fixtures.orgA.id);

      const statusResult = await bulkUpdateClientRequestStatusAction(tooMany, "CLOSED");
      expect(statusResult).toEqual({ updatedCount: 0, failedCount: tooMany.length, failures: [{ id: "", reason: "TOO_MANY_SELECTED" }] });

      const assignResult = await bulkAssignClientRequestAction(tooMany, fixtures.admin.id);
      expect(assignResult).toEqual({ updatedCount: 0, failedCount: tooMany.length, failures: [{ id: "", reason: "TOO_MANY_SELECTED" }] });
    });
  });
});
