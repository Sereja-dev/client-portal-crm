import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/enums";
import { getRunId, testEmail, testSlug } from "../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../support/env";

// Stage 4's single fixture builder. No Supabase Admin API calls anywhere
// here — there is no real Supabase Auth against this local test database
// (see test/support/local-postgres.ts), so a "User" here is just its
// Prisma row, keyed by a locally-generated UUID that test/support/
// auth-mock.ts's mocked Supabase client echoes back as the "authenticated"
// identity. Real Supabase Auth integration is out of scope for Stage 4
// (see the Stage 4 report's Category B list).

export type SeededOrg = { id: string; slug: string };
export type SeededUser = { id: string; email: string; name: string };
export type SeededClient = { id: string; name: string; organizationId: string };
export type SeededProject = { id: string; name: string; clientId: string };
export type SeededTask = { id: string; title: string; projectId: string };
export type SeededInvoice = { id: string; invoiceNumber: string; projectId: string };
export type SeededPortalUser = { id: string; email: string; name: string; clientId: string };
export type SeededInvitation = { id: string; token: string; email: string; organizationId: string };
export type SeededClientInvitation = { id: string; token: string; email: string; clientId: string };
export type SeededAttachment = { id: string; storagePath: string };
export type SeededActivity = { id: string; organizationId: string };

export type TestFixtures = {
  runId: string;
  orgA: SeededOrg;
  orgB: SeededOrg;
  owner: SeededUser;
  admin: SeededUser;
  member: SeededUser;
  orgBOwner: SeededUser;
  clientA: SeededClient;
  clientB: SeededClient;
  project: SeededProject;
  task: SeededTask;
  invoice: SeededInvoice;
  portalUser: SeededPortalUser;
  invitation: SeededInvitation;
  clientInvitation: SeededClientInvitation;
  attachment: SeededAttachment;
  activity: SeededActivity;
};

async function createUser(runId: string, label: string): Promise<SeededUser> {
  const id = randomUUID();
  const email = testEmail(label, TEST_EMAIL_DOMAIN, runId);
  const user = await prisma.user.create({ data: { id, email, name: `Test ${label}` } });
  return { id: user.id, email: user.email, name: user.name };
}

/**
 * Builds one full graph: two organizations (A and B, for cross-org
 * denial tests), three roles in org A (OWNER/ADMIN/MEMBER) plus a second
 * org's OWNER, a Client in each org, a Project/Task/Invoice under org A's
 * Client, a PortalUser + pending ClientInvitation for it, a pending staff
 * Invitation for org A, and one Attachment row (no real Storage object —
 * see test/support/storage-mock.ts). Every id is returned, typed — no
 * magic strings in any test.
 */
export async function seedTestData(runId: string = getRunId()): Promise<TestFixtures> {
  const [owner, admin, member, orgBOwner] = await Promise.all([
    createUser(runId, "owner"),
    createUser(runId, "admin"),
    createUser(runId, "member"),
    createUser(runId, "orgb-owner"),
  ]);

  const orgA = await prisma.organization.create({
    data: { name: "Test Org A", slug: testSlug("org-a", runId) },
  });
  const orgB = await prisma.organization.create({
    data: { name: "Test Org B", slug: testSlug("org-b", runId) },
  });

  await prisma.membership.createMany({
    data: [
      { userId: owner.id, organizationId: orgA.id, role: Role.OWNER },
      { userId: admin.id, organizationId: orgA.id, role: Role.ADMIN },
      { userId: member.id, organizationId: orgA.id, role: Role.MEMBER },
      { userId: orgBOwner.id, organizationId: orgB.id, role: Role.OWNER },
    ],
  });

  const clientA = await prisma.client.create({
    data: { name: "Test Client A", organizationId: orgA.id, userId: owner.id },
  });
  const clientB = await prisma.client.create({
    data: { name: "Test Client B", organizationId: orgB.id, userId: orgBOwner.id },
  });

  const project = await prisma.project.create({
    data: {
      name: "Test Project",
      clientId: clientA.id,
      organizationId: orgA.id,
      ownerId: owner.id,
      status: "IN_PROGRESS",
    },
  });

  const task = await prisma.task.create({
    data: {
      title: "Test Task",
      projectId: project.id,
      organizationId: orgA.id,
      status: "TODO",
      priority: "MEDIUM",
    },
  });

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: `INV-TEST-${runId}`,
      clientId: clientA.id,
      projectId: project.id,
      organizationId: orgA.id,
      amount: "500.00",
      status: "DRAFT",
      issueDate: new Date(),
    },
  });

  const portalUserId = randomUUID();
  const portalUser = await prisma.portalUser.create({
    data: {
      id: portalUserId,
      clientId: clientA.id,
      email: testEmail("portal-a", TEST_EMAIL_DOMAIN, runId),
      name: "Test Portal User A",
    },
  });

  const invitation = await prisma.invitation.create({
    data: {
      organizationId: orgA.id,
      email: testEmail("invitee", TEST_EMAIL_DOMAIN, runId),
      role: Role.MEMBER,
      token: randomUUID(),
      status: "PENDING",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      invitedById: owner.id,
    },
  });

  const clientInvitation = await prisma.clientInvitation.create({
    data: {
      clientId: clientA.id,
      email: testEmail("portal-invitee", TEST_EMAIL_DOMAIN, runId),
      token: randomUUID(),
      status: "PENDING",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      invitedById: owner.id,
    },
  });

  // No real Storage object — this row is the DB-side half of an
  // Attachment only; test/support/storage-mock.ts stands in for the
  // Storage side wherever a test actually exercises the upload/delete
  // mutation functions.
  const attachmentId = randomUUID();
  const attachment = await prisma.attachment.create({
    data: {
      id: attachmentId,
      organizationId: orgA.id,
      uploadedById: owner.id,
      entityType: "CLIENT",
      entityId: clientA.id,
      storageBucket: "attachments",
      storagePath: `organizations/${orgA.id}/CLIENT/${clientA.id}/${attachmentId}/report.pdf`,
      originalName: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    },
  });

  const activity = await prisma.activity.create({
    data: {
      organizationId: orgA.id,
      actorId: owner.id,
      entityType: "CLIENT",
      entityId: clientA.id,
      action: "CREATED",
      metadata: { name: clientA.name, status: "LEAD", actorName: owner.name },
    },
  });

  return {
    runId,
    orgA: { id: orgA.id, slug: orgA.slug },
    orgB: { id: orgB.id, slug: orgB.slug },
    owner,
    admin,
    member,
    orgBOwner,
    clientA: { id: clientA.id, name: clientA.name, organizationId: orgA.id },
    clientB: { id: clientB.id, name: clientB.name, organizationId: orgB.id },
    project: { id: project.id, name: project.name, clientId: clientA.id },
    task: { id: task.id, title: task.title, projectId: project.id },
    invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, projectId: project.id },
    portalUser: { id: portalUser.id, email: portalUser.email, name: portalUser.name, clientId: clientA.id },
    invitation: { id: invitation.id, token: invitation.token, email: invitation.email, organizationId: orgA.id },
    clientInvitation: {
      id: clientInvitation.id,
      token: clientInvitation.token,
      email: clientInvitation.email,
      clientId: clientA.id,
    },
    attachment: { id: attachment.id, storagePath: attachment.storagePath },
    activity: { id: activity.id, organizationId: orgA.id },
  };
}

/**
 * Deletes exactly the graph seedTestData() created, by id — precise
 * rather than a broad runId-scoped query, so concurrent test files
 * sharing the one test database (see test/support/local-postgres.ts)
 * never risk deleting each other's rows.
 *
 * Order matters: Invoice.client/Invoice.project are both onDelete:
 * Restrict, so every Invoice under these Clients/Projects must go first
 * (deleteMany by clientId, not just the one seeded id, so a test that
 * creates an extra Invoice under the same fixture Client doesn't leave a
 * dangling row blocking cleanup). InvoicePdfArchiveObject.organizationId
 * is likewise onDelete: Restrict (Invoice System Slice 3, sub-PR 3b's own
 * durable archival ledger — deleting an Organization must never silently
 * erase it) — a scenario (integration or E2E) that actually issues an
 * invoice leaves a REFERENCED ledger row behind, which must be removed
 * before the Organization can be deleted at all. Client then cascades
 * Project/Task/ClientInvitation/PortalUser; Organization cascades
 * Membership/Invitation/Attachment/Activity; Users are deleted last since
 * Client.userId/Project.ownerId are also onDelete: Restrict.
 */
export async function cleanupTestData(fixtures: TestFixtures): Promise<void> {
  const clientIds = [fixtures.clientA.id, fixtures.clientB.id];
  const orgIds = [fixtures.orgA.id, fixtures.orgB.id];
  await prisma.invoicePdfArchiveObject.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.invoice.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({
    where: { id: { in: [fixtures.owner.id, fixtures.admin.id, fixtures.member.id, fixtures.orgBOwner.id] } },
  });
}

/**
 * Identity for ONE seeded graph in a shared-database run (the E2E suite).
 *
 * `seedTestData()` derives every email, slug and invoice number from its
 * `runId`, and in CI that is the same GITHUB_RUN_ID for every spec file. So
 * any row that outlives one file's cleanup — e.g. a User re-created by the
 * app's own `getOrCreateUser()` upsert when a late request still carrying the
 * test session reaches the server after `afterAll` deleted the users —
 * collided with the NEXT file's seed (`Unique constraint failed on the
 * fields: (email)`), and every later spec failed in `beforeAll`.
 *
 * A seed-unique prefix keeps the existing `-{runId}@{domain}` / `-{runId}`
 * suffixes (so `cleanupTestRun(runId)` still matches everything) while making
 * each graph's identities its own.
 */
export function newSeedRunId(baseRunId: string = getRunId()): string {
  return `${randomBytes(4).toString("hex")}-${baseRunId}`;
}

export type SeededCleanupOptions = {
  /** How long to let in-flight app requests land before verifying (default 300 ms; a late request was observed ~180 ms after deletion). */
  settleMs?: number;
  /** Delete/settle/verify rounds before giving up (default 5). */
  maxSweeps?: number;
  /** Test hook, called after each settle and before verification. */
  onSettle?: (sweep: number) => Promise<void> | void;
};

function fixtureUserIds(fixtures: TestFixtures): string[] {
  return [fixtures.owner.id, fixtures.admin.id, fixtures.member.id, fixtures.orgBOwner.id];
}

async function remainingFixtureRows(fixtures: TestFixtures): Promise<string[]> {
  const [users, orgs, clients] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: fixtureUserIds(fixtures) } }, select: { email: true } }),
    prisma.organization.findMany({ where: { id: { in: [fixtures.orgA.id, fixtures.orgB.id] } }, select: { slug: true } }),
    prisma.client.findMany({ where: { id: { in: [fixtures.clientA.id, fixtures.clientB.id] } }, select: { name: true } }),
  ]);
  return [
    ...users.map((u) => `user ${u.email}`),
    ...orgs.map((o) => `organization ${o.slug}`),
    ...clients.map((c) => `client ${c.name}`),
  ];
}

/**
 * Cleanup for a graph created with a seed-unique `runId` (see newSeedRunId).
 * Convergent: deletes, lets in-flight requests land, verifies, and repeats —
 * so a User re-created by a late request after the first delete is removed
 * too. If the fixture graph itself is still present after the last round it
 * throws, naming the rows, so a leak fails the spec that caused it instead of
 * silently breaking whichever file runs next.
 *
 * Only identities carrying THIS graph's own seed-unique suffix are swept
 * beyond the fixture ids (spec-created extras: best effort, errors ignored),
 * so data belonging to other specs or runs is never touched.
 */
export async function cleanupSeededFixtures(fixtures: TestFixtures, options: SeededCleanupOptions = {}): Promise<void> {
  const { settleMs = 300, maxSweeps = 5, onSettle } = options;
  const seedScoped = fixtures.runId !== getRunId();
  let remaining: string[] = [];
  for (let sweep = 1; sweep <= maxSweeps; sweep += 1) {
    await cleanupTestData(fixtures);
    if (seedScoped) {
      await prisma.organization.deleteMany({ where: { slug: { endsWith: `-${fixtures.runId}` } } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { email: { endsWith: `-${fixtures.runId}@${TEST_EMAIL_DOMAIN}` } } }).catch(() => undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    await onSettle?.(sweep);
    remaining = await remainingFixtureRows(fixtures);
    if (remaining.length === 0) return;
  }
  throw new Error(
    `cleanupSeededFixtures: fixture rows for seed ${fixtures.runId} still present after ${maxSweeps} sweeps: ${remaining.join(", ")}`,
  );
}
