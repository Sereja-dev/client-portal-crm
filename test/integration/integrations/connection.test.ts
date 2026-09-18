import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  saveSlackWebhook,
  disconnectSlackIntegration,
  sendSlackTestMessage,
  getIntegrationConnectionSummary,
} from "@/lib/integrations/connection";
import { SLACK_PROVIDER } from "@/lib/integrations/provider";
import { testEmail, testSlug } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";
import { resetSlackMock, setSlackSendSuccess, setSlackSendPermanent, capturedSends } from "../../support/slack-mock";

/**
 * Integrations V1 (Slack Incoming Webhook only). Exercises the REAL,
 * unmodified src/lib/integrations/connection.ts end-to-end (validation ->
 * encryption -> transaction -> Activity -> post-commit test send), the
 * same "only externally-networked things are mocked" discipline every
 * other integration test in this suite already follows — the outbound
 * Slack HTTP call is swapped for test/support/slack-mock.ts's controllable
 * fake (see test/integration/setup-mocks.ts), never the real network.
 */

const VALID_URL = "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXXXXXXXXXX";
const VALID_URL_2 = "https://hooks.slack.com/services/T111/B111/YYYYYYYYYYYYYYYYYYYYYYYY";

async function createOrg(label: string): Promise<{ orgId: string; userId: string }> {
  const org = await prisma.organization.create({
    data: { name: `Integrations Test Org ${label}`, slug: testSlug(`integrations-${label}-${randomUUID().slice(0, 8)}`) },
  });
  const user = await prisma.user.create({
    data: { email: testEmail(`integrations-${label}-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN), name: `Owner ${label}` },
  });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
  return { orgId: org.id, userId: user.id };
}

async function cleanupOrg(orgId: string, userId: string): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

describe("connection.ts — Slack connection lifecycle", () => {
  let orgId: string;
  let userId: string;

  beforeEach(async () => {
    resetSlackMock();
    setSlackSendSuccess();
    const created = await createOrg(randomUUID().slice(0, 8));
    orgId = created.orgId;
    userId = created.userId;
  });

  afterEach(async () => {
    await cleanupOrg(orgId, userId);
  });

  it("connects successfully: CONNECTED status, safe projection has no credential, one CREATED Activity", async () => {
    const result = await saveSlackWebhook({
      organizationId: orgId,
      actorId: userId,
      actorName: "Owner",
      webhookUrl: VALID_URL,
      label: "#sales",
    });
    expect(result).toEqual({ ok: true, testWarning: null });

    const summary = await getIntegrationConnectionSummary(orgId);
    expect(summary?.status).toBe("CONNECTED");
    expect(summary?.label).toBe("#sales");
    expect(Object.keys(summary ?? {})).not.toContain("encryptedCredential");

    const raw = await prisma.integrationConnection.findUniqueOrThrow({
      where: { organizationId_provider: { organizationId: orgId, provider: SLACK_PROVIDER } },
    });
    expect(raw.encryptedCredential).not.toBeNull();
    expect(raw.encryptedCredential).not.toContain(VALID_URL);
    expect(raw.credentialKeyVersion).toBe(1);

    const activities = await prisma.activity.findMany({ where: { organizationId: orgId, entityType: "INTEGRATION_CONNECTION" } });
    expect(activities).toHaveLength(1);
    expect(activities[0].action).toBe("CREATED");
    expect(JSON.stringify(activities[0].metadata)).not.toContain(VALID_URL);

    expect(capturedSends).toHaveLength(1);
    expect(capturedSends[0].url).toBe(VALID_URL);
  });

  it("rejects an invalid webhook URL with no DB write", async () => {
    const result = await saveSlackWebhook({
      organizationId: orgId,
      actorId: userId,
      actorName: "Owner",
      webhookUrl: "https://example.com/not-slack",
      label: null,
    });
    expect(result.ok).toBe(false);
    const summary = await getIntegrationConnectionSummary(orgId);
    expect(summary).toBeNull();
    expect(capturedSends).toHaveLength(0);
  });

  it("a failed post-connect test send marks the connection ERROR but still persists it, with a warning", async () => {
    setSlackSendPermanent("SLACK_CLIENT_ERROR");
    const result = await saveSlackWebhook({
      organizationId: orgId,
      actorId: userId,
      actorName: "Owner",
      webhookUrl: VALID_URL,
      label: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.testWarning).not.toBeNull();

    const summary = await getIntegrationConnectionSummary(orgId);
    expect(summary?.status).toBe("ERROR");
    expect(summary?.lastErrorCode).toBe("SLACK_CLIENT_ERROR");

    // CREATED (persist) then STATUS_CHANGED (CONNECTED -> ERROR).
    const activities = await prisma.activity.findMany({
      where: { organizationId: orgId, entityType: "INTEGRATION_CONNECTION" },
      orderBy: { createdAt: "asc" },
    });
    expect(activities.map((a) => a.action)).toEqual(["CREATED", "STATUS_CHANGED"]);
  });

  it("replacing an existing CONNECTED webhook writes UPDATED (not CREATED/STATUS_CHANGED) and clears the old ciphertext", async () => {
    await saveSlackWebhook({ organizationId: orgId, actorId: userId, actorName: "Owner", webhookUrl: VALID_URL, label: null });
    const before = await prisma.integrationConnection.findUniqueOrThrow({
      where: { organizationId_provider: { organizationId: orgId, provider: SLACK_PROVIDER } },
    });

    const result = await saveSlackWebhook({
      organizationId: orgId,
      actorId: userId,
      actorName: "Owner",
      webhookUrl: VALID_URL_2,
      label: null,
    });
    expect(result.ok).toBe(true);

    const after = await prisma.integrationConnection.findUniqueOrThrow({
      where: { organizationId_provider: { organizationId: orgId, provider: SLACK_PROVIDER } },
    });
    expect(after.encryptedCredential).not.toBe(before.encryptedCredential);
    expect(after.id).toBe(before.id); // Same row, not a new one — @@unique([organizationId, provider]).

    const activities = await prisma.activity.findMany({
      where: { organizationId: orgId, entityType: "INTEGRATION_CONNECTION" },
      orderBy: { createdAt: "asc" },
    });
    expect(activities.map((a) => a.action)).toEqual(["CREATED", "UPDATED"]);
  });

  it("reconnecting from DISCONNECTED writes STATUS_CHANGED, not UPDATED", async () => {
    await saveSlackWebhook({ organizationId: orgId, actorId: userId, actorName: "Owner", webhookUrl: VALID_URL, label: null });
    await disconnectSlackIntegration({ organizationId: orgId, actorId: userId, actorName: "Owner" });

    await saveSlackWebhook({ organizationId: orgId, actorId: userId, actorName: "Owner", webhookUrl: VALID_URL, label: null });

    const activities = await prisma.activity.findMany({
      where: { organizationId: orgId, entityType: "INTEGRATION_CONNECTION" },
      orderBy: { createdAt: "asc" },
    });
    expect(activities.map((a) => a.action)).toEqual(["CREATED", "STATUS_CHANGED", "STATUS_CHANGED"]);
  });

  it("disconnect clears the credential and cancels queued deliveries", async () => {
    await saveSlackWebhook({ organizationId: orgId, actorId: userId, actorName: "Owner", webhookUrl: VALID_URL, label: null });
    const connection = await prisma.integrationConnection.findUniqueOrThrow({
      where: { organizationId_provider: { organizationId: orgId, provider: SLACK_PROVIDER } },
    });

    const activity = await prisma.activity.create({
      data: { organizationId: orgId, actorId: userId, entityType: "LEAD", entityId: randomUUID(), action: "CREATED", metadata: { name: "x" } },
    });
    await prisma.integrationDelivery.create({
      data: { organizationId: orgId, integrationConnectionId: connection.id, activityId: activity.id, eventKey: "LEAD_CREATED", status: "PENDING" },
    });

    const result = await disconnectSlackIntegration({ organizationId: orgId, actorId: userId, actorName: "Owner" });
    expect(result.ok).toBe(true);

    const after = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(after.status).toBe("DISCONNECTED");
    expect(after.encryptedCredential).toBeNull();
    expect(after.credentialKeyVersion).toBeNull();

    const delivery = await prisma.integrationDelivery.findFirstOrThrow({ where: { integrationConnectionId: connection.id } });
    expect(delivery.status).toBe("CANCELED");
  });

  it("disconnecting an already-DISCONNECTED (or nonexistent) connection is an idempotent no-op — no duplicate Activity", async () => {
    const result = await disconnectSlackIntegration({ organizationId: orgId, actorId: userId, actorName: "Owner" });
    expect(result.ok).toBe(true);
    const activities = await prisma.activity.findMany({ where: { organizationId: orgId, entityType: "INTEGRATION_CONNECTION" } });
    expect(activities).toHaveLength(0);

    await saveSlackWebhook({ organizationId: orgId, actorId: userId, actorName: "Owner", webhookUrl: VALID_URL, label: null });
    await disconnectSlackIntegration({ organizationId: orgId, actorId: userId, actorName: "Owner" });
    await disconnectSlackIntegration({ organizationId: orgId, actorId: userId, actorName: "Owner" });

    const statusChanges = await prisma.activity.findMany({
      where: { organizationId: orgId, entityType: "INTEGRATION_CONNECTION", action: "STATUS_CHANGED" },
    });
    expect(statusChanges).toHaveLength(1); // Only the first disconnect wrote one.
  });

  it("Send test: success on an ERROR connection clears it back to CONNECTED", async () => {
    setSlackSendPermanent();
    await saveSlackWebhook({ organizationId: orgId, actorId: userId, actorName: "Owner", webhookUrl: VALID_URL, label: null });
    expect((await getIntegrationConnectionSummary(orgId))?.status).toBe("ERROR");

    setSlackSendSuccess();
    const result = await sendSlackTestMessage({ organizationId: orgId, actorId: userId, actorName: "Owner" });
    expect(result.ok).toBe(true);
    const summary = await getIntegrationConnectionSummary(orgId);
    expect(summary?.status).toBe("CONNECTED");
    expect(summary?.lastErrorCode).toBeNull();
  });

  it("Send test: failure does NOT disconnect (credential stays present)", async () => {
    await saveSlackWebhook({ organizationId: orgId, actorId: userId, actorName: "Owner", webhookUrl: VALID_URL, label: null });
    setSlackSendPermanent();
    const result = await sendSlackTestMessage({ organizationId: orgId, actorId: userId, actorName: "Owner" });
    expect(result.ok).toBe(false);

    const raw = await prisma.integrationConnection.findUniqueOrThrow({
      where: { organizationId_provider: { organizationId: orgId, provider: SLACK_PROVIDER } },
    });
    expect(raw.status).toBe("ERROR");
    expect(raw.encryptedCredential).not.toBeNull(); // Never wiped by a failed test.
  });

  it("Send test with no connection returns a clean error, never throws", async () => {
    const result = await sendSlackTestMessage({ organizationId: orgId, actorId: userId, actorName: "Owner" });
    expect(result.ok).toBe(false);
  });

  it("tenant isolation: org A's connection is invisible to org B's summary query", async () => {
    const other = await createOrg(randomUUID().slice(0, 8));
    try {
      await saveSlackWebhook({ organizationId: orgId, actorId: userId, actorName: "Owner", webhookUrl: VALID_URL, label: null });
      const otherSummary = await getIntegrationConnectionSummary(other.orgId);
      expect(otherSummary).toBeNull();
    } finally {
      await cleanupOrg(other.orgId, other.userId);
    }
  });

  it("a ciphertext copied to another organization's AAD context fails to decrypt (proven via crypto.ts directly)", async () => {
    await saveSlackWebhook({ organizationId: orgId, actorId: userId, actorName: "Owner", webhookUrl: VALID_URL, label: null });
    const raw = await prisma.integrationConnection.findUniqueOrThrow({
      where: { organizationId_provider: { organizationId: orgId, provider: SLACK_PROVIDER } },
    });
    const { decryptCredential, IntegrationCredentialCryptoError } = await import("@/lib/integrations/crypto");
    expect(() =>
      decryptCredential(raw.encryptedCredential!, raw.credentialKeyVersion!, { organizationId: "different-org", provider: SLACK_PROVIDER }),
    ).toThrow(IntegrationCredentialCryptoError);
  });
});
