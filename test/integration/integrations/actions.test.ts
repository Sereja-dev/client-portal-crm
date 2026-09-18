import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/enums";
import {
  saveSlackWebhookAction,
  disconnectSlackAction,
  sendSlackTestAction,
} from "@/app/(dashboard)/settings/integrations/actions";
import { testEmail, testSlug } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { resetSlackMock, setSlackSendSuccess } from "../../support/slack-mock";

/**
 * Integrations V1 (Slack Incoming Webhook only, locked spec §10/§39).
 * Exercises the REAL Server Actions end-to-end — every one of the three
 * independently re-checks OWNER before touching anything, the same
 * "never left to a single call site" discipline this file's own
 * counterpart (test/integration/permissions/management.test.ts) already
 * exercises for /team/permissions.
 */

type RoleTrioUser = { id: string; email: string; name: string };

async function createRoleTrio(): Promise<{ orgId: string; owner: RoleTrioUser; admin: RoleTrioUser; member: RoleTrioUser }> {
  const org = await prisma.organization.create({
    data: { name: "Integrations Actions Test Org", slug: testSlug(`integrations-actions-${randomUUID().slice(0, 8)}`) },
  });

  async function makeUser(label: string, role: Role): Promise<RoleTrioUser> {
    const id = randomUUID();
    const email = testEmail(`integrations-actions-${label}-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN);
    const user = await prisma.user.create({ data: { id, email, name: `Integrations ${label}` } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role } });
    return { id: user.id, email: user.email, name: user.name };
  }

  const [owner, admin, member] = await Promise.all([
    makeUser("owner", Role.OWNER),
    makeUser("admin", Role.ADMIN),
    makeUser("member", Role.MEMBER),
  ]);

  return { orgId: org.id, owner, admin, member };
}

async function cleanupRoleTrio(orgId: string, userIds: readonly string[]): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
}

const VALID_URL = "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXXXXXXXXXX";

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("Integrations Server Actions — authorization boundary", () => {
  let orgId: string;
  let owner: RoleTrioUser;
  let admin: RoleTrioUser;
  let member: RoleTrioUser;

  beforeEach(async () => {
    resetSlackMock();
    setSlackSendSuccess();
    const trio = await createRoleTrio();
    orgId = trio.orgId;
    owner = trio.owner;
    admin = trio.admin;
    member = trio.member;
  });

  afterEach(async () => {
    resetAuthMock();
    await cleanupRoleTrio(orgId, [owner.id, admin.id, member.id]);
  });

  it("ADMIN is denied by saveSlackWebhookAction, no row written", async () => {
    actAs({ id: admin.id, email: admin.email }, orgId);
    const result = await saveSlackWebhookAction({ error: null }, buildFormData({ webhookUrl: VALID_URL }));
    expect(result.error).toBe("Integrations are only available to the organization owner.");
    const connection = await prisma.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId: orgId, provider: "SLACK_INCOMING_WEBHOOK" } },
    });
    expect(connection).toBeNull();
  });

  it("MEMBER is denied by saveSlackWebhookAction", async () => {
    actAs({ id: member.id, email: member.email }, orgId);
    const result = await saveSlackWebhookAction({ error: null }, buildFormData({ webhookUrl: VALID_URL }));
    expect(result.error).toBe("Integrations are only available to the organization owner.");
  });

  it("OWNER can connect via the real Server Action", async () => {
    actAs({ id: owner.id, email: owner.email }, orgId);
    const result = await saveSlackWebhookAction({ error: null }, buildFormData({ webhookUrl: VALID_URL }));
    expect(result.error).toBeNull();
    const connection = await prisma.integrationConnection.findUniqueOrThrow({
      where: { organizationId_provider: { organizationId: orgId, provider: "SLACK_INCOMING_WEBHOOK" } },
    });
    expect(connection.status).toBe("CONNECTED");
  });

  it("ADMIN/MEMBER are denied by disconnectSlackAction and sendSlackTestAction", async () => {
    actAs({ id: owner.id, email: owner.email }, orgId);
    await saveSlackWebhookAction({ error: null }, buildFormData({ webhookUrl: VALID_URL }));

    actAs({ id: admin.id, email: admin.email }, orgId);
    expect((await disconnectSlackAction()).error).toBe("Integrations are only available to the organization owner.");
    expect((await sendSlackTestAction()).error).toBe("Integrations are only available to the organization owner.");

    actAs({ id: member.id, email: member.email }, orgId);
    expect((await disconnectSlackAction()).error).toBe("Integrations are only available to the organization owner.");
    expect((await sendSlackTestAction()).error).toBe("Integrations are only available to the organization owner.");

    // Neither denied call actually disconnected it.
    const connection = await prisma.integrationConnection.findUniqueOrThrow({
      where: { organizationId_provider: { organizationId: orgId, provider: "SLACK_INCOMING_WEBHOOK" } },
    });
    expect(connection.status).toBe("CONNECTED");
  });

  it("an empty webhook URL is rejected with a validation error, not a crash", async () => {
    actAs({ id: owner.id, email: owner.email }, orgId);
    const result = await saveSlackWebhookAction({ error: null }, buildFormData({ webhookUrl: "" }));
    expect(result.error).toBe("Enter a Slack webhook URL.");
  });
});
