import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  updateClientRequestStatusAction,
  updateClientRequestPriorityAction,
  assignClientRequestAction,
  linkClientRequestProjectAction,
  archiveClientRequestAction,
  unarchiveClientRequestAction,
  addStaffClientRequestMessageAction,
} from "@/app/(dashboard)/requests/actions";
import { createPortalClientRequest } from "@/lib/client-requests/portal";
import { listOrganizationClientRequests, getOrganizationClientRequest } from "@/lib/client-requests/staff";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * Client Requests / Tickets Phase 2A — Staff Server Action layer (test
 * items 11-22, 26). Mirrors test/integration/lead-capture-forms/
 * settings-actions.test.ts's own seedTestData/actAs pattern.
 */

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

async function cleanupRequests(organizationIds: string[]) {
  await prisma.clientRequest.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

describe("Client Requests — Staff Server Actions", () => {
  let fixtures: TestFixtures;

  async function createRequest(clientId = fixtures.clientA.id, organizationId = fixtures.orgA.id) {
    const result = await createPortalClientRequest(
      { organizationId, clientId, portalUserId: fixtures.portalUser.id, portalUserName: "Portal User" },
      { title: "Site is down", description: "Nothing loads." },
    );
    if (!result.ok) throw new Error("expected ok");
    return result.request;
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

  it("11. Staff list (via the domain layer the list page itself calls) only shows own organization requests, with client/assignee/project display data attached", async () => {
    const own = await createRequest();
    const foreign = await prisma.clientRequest.create({
      data: { organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, title: "Org B", description: "D" },
    });

    const list = await listOrganizationClientRequests(fixtures.orgA.id);
    expect(list.map((r) => r.id)).toContain(own.id);
    expect(list.map((r) => r.id)).not.toContain(foreign.id);
    expect(list.find((r) => r.id === own.id)?.client.name).toBe(fixtures.clientA.name);
  });

  it("12. Staff detail renders (getOrganizationClientRequest returns the full display shape)", async () => {
    const request = await createRequest();
    const found = await getOrganizationClientRequest(fixtures.orgA.id, request.id);
    expect(found?.title).toBe("Site is down");
    expect(found?.client.name).toBe(fixtures.clientA.name);
    expect(found?.portalUser?.name).toBe(fixtures.portalUser.name);
  });

  it("13. a cross-org request is inaccessible via getOrganizationClientRequest", async () => {
    const orgBRequest = await prisma.clientRequest.create({
      data: { organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, title: "Org B", description: "D" },
    });
    expect(await getOrganizationClientRequest(fixtures.orgA.id, orgBRequest.id)).toBeNull();
  });

  it("14. status update works via the Server Action", async () => {
    const request = await createRequest();
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateClientRequestStatusAction(request.id, "IN_PROGRESS");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.request.status).toBe("IN_PROGRESS");

    const activity = await prisma.activity.findFirst({ where: { entityType: "CLIENT_REQUEST", entityId: request.id, action: "STATUS_CHANGED" } });
    expect(activity?.actorId).toBe(fixtures.owner.id);
  });

  it("15. priority update works via the Server Action", async () => {
    const request = await createRequest();
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await updateClientRequestPriorityAction(request.id, "URGENT");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.request.priority).toBe("URGENT");
  });

  it("16/17. assign/unassign works, and a cross-org assignee is rejected", async () => {
    const request = await createRequest();
    actAs(fixtures.owner, fixtures.orgA.id);

    const assigned = await assignClientRequestAction(request.id, fixtures.admin.id);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) throw new Error("expected ok");
    expect(assigned.request.assignedToId).toBe(fixtures.admin.id);

    const unassigned = await assignClientRequestAction(request.id, null);
    expect(unassigned.ok).toBe(true);
    if (!unassigned.ok) throw new Error("expected ok");
    expect(unassigned.request.assignedToId).toBeNull();

    const crossOrg = await assignClientRequestAction(request.id, fixtures.orgBOwner.id);
    expect(crossOrg).toEqual({ ok: false, reason: "INVALID_ASSIGNEE" });
  });

  it("18/19. project link/unlink works, and a cross-client project is rejected", async () => {
    const request = await createRequest(fixtures.clientA.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const linked = await linkClientRequestProjectAction(request.id, fixtures.project.id);
    expect(linked.ok).toBe(true);
    if (!linked.ok) throw new Error("expected ok");
    expect(linked.request.projectId).toBe(fixtures.project.id);

    const unlinked = await linkClientRequestProjectAction(request.id, null);
    expect(unlinked.ok).toBe(true);
    if (!unlinked.ok) throw new Error("expected ok");
    expect(unlinked.request.projectId).toBeNull();

    const orgBProject = await prisma.project.create({
      data: { name: "Org B Project", clientId: fixtures.clientB.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id, status: "PLANNING" },
    });
    const crossOrg = await linkClientRequestProjectAction(request.id, orgBProject.id);
    expect(crossOrg).toEqual({ ok: false, reason: "INVALID_PROJECT" });
    await prisma.project.deleteMany({ where: { id: orgBProject.id } });
  });

  it("20. archive/unarchive works via the Server Action", async () => {
    const request = await createRequest();
    actAs(fixtures.owner, fixtures.orgA.id);

    const archived = await archiveClientRequestAction(request.id);
    expect(archived.ok).toBe(true);
    if (!archived.ok) throw new Error("expected ok");
    expect(archived.request.archivedAt).not.toBeNull();

    const unarchived = await unarchiveClientRequestAction(request.id);
    expect(unarchived.ok).toBe(true);
    if (!unarchived.ok) throw new Error("expected ok");
    expect(unarchived.request.archivedAt).toBeNull();
  });

  it("a cross-org staff member's mutation Server Actions all fail with REQUEST_NOT_FOUND, never a raw error", async () => {
    const orgBRequest = await prisma.clientRequest.create({
      data: { organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, title: "Org B", description: "D" },
    });
    actAs(fixtures.owner, fixtures.orgA.id);

    expect(await updateClientRequestStatusAction(orgBRequest.id, "IN_PROGRESS")).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" });
    expect(await updateClientRequestPriorityAction(orgBRequest.id, "HIGH")).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" });
    expect(await assignClientRequestAction(orgBRequest.id, fixtures.owner.id)).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" });
    expect(await linkClientRequestProjectAction(orgBRequest.id, fixtures.project.id)).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" });
    expect(await archiveClientRequestAction(orgBRequest.id)).toEqual({ ok: false, reason: "REQUEST_NOT_FOUND" });
  });

  it("21. Staff can add a message via the Server Action", async () => {
    const request = await createRequest();
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await addStaffClientRequestMessageAction(request.id, { error: null }, formData({ body: "We're looking into it." }));
    expect(result).toEqual({ error: null });

    const message = await prisma.clientRequestMessage.findFirstOrThrow({ where: { requestId: request.id } });
    expect(message.authorType).toBe("STAFF");
    expect(message.staffUserId).toBe(fixtures.owner.id);
  });

  it("22. Staff cannot message another org's request via the Server Action", async () => {
    const orgBRequest = await prisma.clientRequest.create({
      data: { organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, title: "Org B", description: "D" },
    });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await addStaffClientRequestMessageAction(orgBRequest.id, { error: null }, formData({ body: "Cross-org attempt" }));
    expect(result.error).toBeTruthy();
    expect(await prisma.clientRequestMessage.count({ where: { requestId: orgBRequest.id } })).toBe(0);
  });

  it("26. an empty message is rejected by the Staff Server Action, and creates nothing", async () => {
    const request = await createRequest();
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await addStaffClientRequestMessageAction(request.id, { error: null }, formData({ body: "   " }));
    expect(result.error).toBeTruthy();
    expect(await prisma.clientRequestMessage.count({ where: { requestId: request.id } })).toBe(0);
  });

  it("Staff list filters by status/priority/assignedToId", async () => {
    const a = await createRequest();
    const b = await createRequest();
    actAs(fixtures.owner, fixtures.orgA.id);
    await updateClientRequestStatusAction(a.id, "IN_PROGRESS");
    await assignClientRequestAction(b.id, fixtures.admin.id);

    const byStatus = await listOrganizationClientRequests(fixtures.orgA.id, { status: "IN_PROGRESS" });
    expect(byStatus.map((r) => r.id)).toEqual([a.id]);

    const byAssignee = await listOrganizationClientRequests(fixtures.orgA.id, { assignedToId: fixtures.admin.id });
    expect(byAssignee.map((r) => r.id)).toEqual([b.id]);
  });
});
