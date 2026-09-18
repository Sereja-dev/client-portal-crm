import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { enqueueIntegrationDelivery } from "@/lib/integrations/enqueue";
import { attemptIntegrationDelivery, deliverIntegrationEventBestEffort, MAX_DELIVERY_ATTEMPTS } from "@/lib/integrations/deliver";
import { retryIntegrationDeliveries, STALE_LOCK_MS } from "@/lib/integrations/jobs/retry-integration-deliveries";
import { saveSlackWebhook } from "@/lib/integrations/connection";
import { SLACK_PROVIDER } from "@/lib/integrations/provider";
import { testEmail, testSlug } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";
import { resetSlackMock, setSlackSendSuccess, setSlackSendRetryable, setSlackSendPermanent, capturedSends } from "../../support/slack-mock";

const VALID_URL = "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXXXXXXXXXX";

async function createOrgWithConnection(): Promise<{ orgId: string; userId: string; connectionId: string }> {
  const org = await prisma.organization.create({
    data: { name: "Integrations Delivery Test Org", slug: testSlug(`integrations-delivery-${randomUUID().slice(0, 8)}`) },
  });
  const user = await prisma.user.create({
    data: { email: testEmail(`integrations-delivery-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN), name: "Owner" },
  });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });

  setSlackSendSuccess();
  await saveSlackWebhook({ organizationId: org.id, actorId: user.id, actorName: "Owner", webhookUrl: VALID_URL, label: null });
  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where: { organizationId_provider: { organizationId: org.id, provider: SLACK_PROVIDER } },
  });
  return { orgId: org.id, userId: user.id, connectionId: connection.id };
}

async function cleanupOrg(orgId: string, userId: string): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

async function createLeadActivity(orgId: string, userId: string, name = "Jane Doe") {
  return prisma.activity.create({
    data: { organizationId: orgId, actorId: userId, entityType: "LEAD", entityId: randomUUID(), action: "CREATED", metadata: { name } },
  });
}

describe("Integrations — enqueue + delivery + retry worker", () => {
  let orgId: string;
  let userId: string;
  let connectionId: string;

  beforeEach(async () => {
    resetSlackMock();
    const created = await createOrgWithConnection();
    orgId = created.orgId;
    userId = created.userId;
    connectionId = created.connectionId;
    resetSlackMock(); // Clear the connect-time test send capture.
    setSlackSendSuccess();
  });

  afterEach(async () => {
    await cleanupOrg(orgId, userId);
  });

  describe("enqueueIntegrationDelivery", () => {
    it("enqueues exactly one delivery for a supported event (LEAD/CREATED)", async () => {
      const activity = await createLeadActivity(orgId, userId);
      const result = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      expect(result).not.toBeNull();
      const deliveries = await prisma.integrationDelivery.findMany({ where: { activityId: activity.id } });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].eventKey).toBe("LEAD_CREATED");
      expect(deliveries[0].status).toBe("PENDING");
    });

    it("does not enqueue for an unsupported Activity (TASK/CREATED)", async () => {
      const activity = await prisma.activity.create({
        data: { organizationId: orgId, actorId: userId, entityType: "TASK", entityId: randomUUID(), action: "CREATED", metadata: {} },
      });
      const result = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      expect(result).toBeNull();
      expect(await prisma.integrationDelivery.count({ where: { activityId: activity.id } })).toBe(0);
    });

    it("does not enqueue an INVOICE/STATUS_CHANGED for the wrong transition (SENT -> PAID)", async () => {
      const activity = await prisma.activity.create({
        data: {
          organizationId: orgId,
          actorId: userId,
          entityType: "INVOICE",
          entityId: randomUUID(),
          action: "STATUS_CHANGED",
          metadata: { from: "SENT", to: "PAID" },
        },
      });
      const result = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      expect(result).toBeNull();
    });

    it("does not enqueue a CONTRACT/STATUS_CHANGED for the wrong transition (ACCEPTED -> TERMINATED)", async () => {
      const activity = await prisma.activity.create({
        data: {
          organizationId: orgId,
          actorId: userId,
          entityType: "CONTRACT",
          entityId: randomUUID(),
          action: "STATUS_CHANGED",
          metadata: { from: "ACCEPTED", to: "TERMINATED" },
        },
      });
      const result = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      expect(result).toBeNull();
    });

    it("does not enqueue when there is no CONNECTED connection (disconnected org)", async () => {
      const other = await prisma.organization.create({
        data: { name: "No Connection Org", slug: testSlug(`integrations-noconn-${randomUUID().slice(0, 8)}`) },
      });
      const activity = await prisma.activity.create({
        data: { organizationId: other.id, actorId: null, entityType: "LEAD", entityId: randomUUID(), action: "CREATED", metadata: { name: "x" } },
      });
      const result = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: other.id, activity }));
      expect(result).toBeNull();
      await prisma.organization.delete({ where: { id: other.id } });
    });

    it("a duplicate enqueue for the same (connection, activity, eventKey) is a silent no-op", async () => {
      const activity = await createLeadActivity(orgId, userId);
      const first = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      const second = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(await prisma.integrationDelivery.count({ where: { activityId: activity.id } })).toBe(1);
    });

    it("business transaction rollback also rolls back the delivery enqueue", async () => {
      const activity = await createLeadActivity(orgId, userId);
      await expect(
        prisma.$transaction(async (tx) => {
          await enqueueIntegrationDelivery(tx, { organizationId: orgId, activity });
          throw new Error("force rollback");
        }),
      ).rejects.toThrow("force rollback");
      expect(await prisma.integrationDelivery.count({ where: { activityId: activity.id } })).toBe(0);
    });

    it("enqueued delivery's tenant matches both the Activity and the connection", async () => {
      const activity = await createLeadActivity(orgId, userId);
      await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      const delivery = await prisma.integrationDelivery.findFirstOrThrow({ where: { activityId: activity.id } });
      expect(delivery.organizationId).toBe(orgId);
      expect(delivery.integrationConnectionId).toBe(connectionId);
    });
  });

  describe("deliverIntegrationEventBestEffort (post-commit, request-bound) and business-mutation independence", () => {
    it("a Slack outage never throws back to the caller — the business mutation is unaffected", async () => {
      setSlackSendRetryable();
      const activity = await createLeadActivity(orgId, userId);
      const enqueued = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      await expect(deliverIntegrationEventBestEffort(enqueued!.deliveryId)).resolves.toBeUndefined();
      const delivery = await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: enqueued!.deliveryId } });
      expect(delivery.status).toBe("FAILED");
      expect(delivery.nextAttemptAt).not.toBeNull();
    });

    it("delivers on the first synchronous attempt when Slack succeeds", async () => {
      const activity = await createLeadActivity(orgId, userId);
      const enqueued = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      await deliverIntegrationEventBestEffort(enqueued!.deliveryId);
      const delivery = await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: enqueued!.deliveryId } });
      expect(delivery.status).toBe("DELIVERED");
      expect(delivery.attempts).toBe(1);
      expect(capturedSends).toHaveLength(1);
      expect(capturedSends[0].text).toContain("New lead: Jane Doe");
    });
  });

  describe("attemptIntegrationDelivery", () => {
    it("a permanent failure on the first attempt is terminal (no nextAttemptAt) and flips the connection to ERROR", async () => {
      setSlackSendPermanent("SLACK_CLIENT_ERROR");
      const activity = await createLeadActivity(orgId, userId);
      const enqueued = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      const outcome = await attemptIntegrationDelivery({ deliveryId: enqueued!.deliveryId, fromStatus: "PENDING", now: new Date() });
      expect(outcome.outcome).toBe("failed_terminal");
      const delivery = await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: enqueued!.deliveryId } });
      expect(delivery.status).toBe("FAILED");
      expect(delivery.nextAttemptAt).toBeNull();
      const connection = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(connection.status).toBe("ERROR");
    });

    it("reaching MAX_DELIVERY_ATTEMPTS on retryable failures is terminal", async () => {
      setSlackSendRetryable();
      const activity = await createLeadActivity(orgId, userId);
      const enqueued = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));

      let outcome;
      for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
        outcome = await attemptIntegrationDelivery({
          deliveryId: enqueued!.deliveryId,
          fromStatus: i === 0 ? "PENDING" : "PROCESSING",
          now: new Date(),
        });
        if (i < MAX_DELIVERY_ATTEMPTS - 1) {
          expect(outcome.outcome).toBe("retry_scheduled");
          await prisma.integrationDelivery.update({ where: { id: enqueued!.deliveryId }, data: { status: "PROCESSING" } });
        }
      }
      expect(outcome!.outcome).toBe("failed_terminal");
      const delivery = await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: enqueued!.deliveryId } });
      expect(delivery.attempts).toBe(MAX_DELIVERY_ATTEMPTS);
    });

    it("a disconnected connection at send-time cancels the delivery, never sends", async () => {
      const activity = await createLeadActivity(orgId, userId);
      const enqueued = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      await prisma.integrationConnection.update({ where: { id: connectionId }, data: { status: "DISCONNECTED", encryptedCredential: null, credentialKeyVersion: null } });

      const outcome = await attemptIntegrationDelivery({ deliveryId: enqueued!.deliveryId, fromStatus: "PENDING", now: new Date() });
      expect(outcome).toEqual({ outcome: "skipped", reason: "connection_disconnected" });
      expect(capturedSends).toHaveLength(0);
      const delivery = await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: enqueued!.deliveryId } });
      expect(delivery.status).toBe("CANCELED");
    });

    it("a completion write conditioned on a stale fromStatus (e.g. concurrently CANCELED by Disconnect) is skipped, not clobbered — proves the disconnect/in-flight race guard", async () => {
      const activity = await createLeadActivity(orgId, userId);
      const enqueued = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      // Simulate: worker already claimed (PROCESSING) and is mid-HTTP-call
      // when Disconnect concurrently cancels the same row.
      await prisma.integrationDelivery.update({ where: { id: enqueued!.deliveryId }, data: { status: "CANCELED" } });

      const outcome = await attemptIntegrationDelivery({ deliveryId: enqueued!.deliveryId, fromStatus: "PROCESSING", now: new Date() });
      expect(outcome).toEqual({ outcome: "skipped", reason: "raced" });
      const delivery = await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: enqueued!.deliveryId } });
      expect(delivery.status).toBe("CANCELED"); // Never overwritten back to DELIVERED/FAILED.
    });
  });

  describe("retryIntegrationDeliveries (worker)", () => {
    it("claims and delivers a PENDING row", async () => {
      const activity = await createLeadActivity(orgId, userId);
      const enqueued = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      const summary = await retryIntegrationDeliveries({ now: new Date(), limit: 10 });
      expect(summary.claimed).toBe(1);
      expect(summary.delivered).toBe(1);
      const delivery = await prisma.integrationDelivery.findUniqueOrThrow({ where: { id: enqueued!.deliveryId } });
      expect(delivery.status).toBe("DELIVERED");
    });

    it("claims a FAILED row only once its nextAttemptAt has passed", async () => {
      const activity = await createLeadActivity(orgId, userId);
      const enqueued = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      const future = new Date(Date.now() + 60 * 60 * 1000);
      await prisma.integrationDelivery.update({
        where: { id: enqueued!.deliveryId },
        data: { status: "FAILED", attempts: 1, nextAttemptAt: future },
      });

      const tooEarly = await retryIntegrationDeliveries({ now: new Date(), limit: 10 });
      expect(tooEarly.claimed).toBe(0);

      const dueNow = await retryIntegrationDeliveries({ now: new Date(future.getTime() + 1), limit: 10 });
      expect(dueNow.claimed).toBe(1);
    });

    it("reclaims a stale PROCESSING row left by a crashed worker", async () => {
      const activity = await createLeadActivity(orgId, userId);
      const enqueued = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      const staleLockedAt = new Date(Date.now() - STALE_LOCK_MS - 1000);
      await prisma.integrationDelivery.update({ where: { id: enqueued!.deliveryId }, data: { status: "PROCESSING", lockedAt: staleLockedAt } });

      const summary = await retryIntegrationDeliveries({ now: new Date(), limit: 10 });
      expect(summary.claimed).toBe(1);
      expect(summary.delivered).toBe(1);
    });

    it("does NOT claim a fresh (non-stale) PROCESSING row — another worker still legitimately owns it", async () => {
      const activity = await createLeadActivity(orgId, userId);
      const enqueued = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      await prisma.integrationDelivery.update({ where: { id: enqueued!.deliveryId }, data: { status: "PROCESSING", lockedAt: new Date() } });

      const summary = await retryIntegrationDeliveries({ now: new Date(), limit: 10 });
      expect(summary.claimed).toBe(0);
    });

    it("never claims a CANCELED or DELIVERED row", async () => {
      const activity = await createLeadActivity(orgId, userId);
      const enqueued = await prisma.$transaction((tx) => enqueueIntegrationDelivery(tx, { organizationId: orgId, activity }));
      await prisma.integrationDelivery.update({ where: { id: enqueued!.deliveryId }, data: { status: "CANCELED" } });
      expect((await retryIntegrationDeliveries({ now: new Date(), limit: 10 })).claimed).toBe(0);
    });
  });
});
