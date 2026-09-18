import "server-only";
import { prisma } from "@/lib/prisma";
import { createActivity } from "@/lib/activity/create-activity";
import { buildIntegrationConnectionMetadata } from "@/lib/activity/integration-connection-metadata";
import { encryptCredential, decryptCredential, IntegrationCredentialCryptoError } from "./crypto";
import { validateSlackWebhookUrl, describeSlackWebhookUrlRejection } from "./slack-url";
import { sendSlackMessage } from "./slack-client";
import { SLACK_PROVIDER, CONNECTION_STATUS } from "./provider";
import type { IntegrationErrorCode } from "./error-codes";

/**
 * Integrations V1 (Slack Incoming Webhook only -- architecture lock
 * validation, locked spec §13/§14/§15/§16). The one module every
 * connection-lifecycle Server Action (connect, replace, disconnect, send
 * test) delegates to — no route/action file reaches into Prisma or the
 * crypto/URL/HTTP modules directly.
 *
 * Activity semantics for saveSlackWebhook (connect AND replace share one
 * core, since the required Activity branching is a pure function of the
 * connection's pre-existing state, not of which UI button was clicked):
 *   - no existing row                    -> CREATED
 *   - existing row, status DISCONNECTED  -> STATUS_CHANGED (reactivating)
 *   - existing row, status ERROR         -> STATUS_CHANGED (reactivating)
 *   - existing row, status CONNECTED     -> UPDATED (credential replaced,
 *                                            no status transition)
 *
 * ERROR semantics (locked spec §10/§24): a connection only ever moves to
 * ERROR for (a) an explicit connect/replace/test-send failure -- this
 * module's own post-commit test and sendSlackTestMessage below -- or (b)
 * a delivery's full retry-ceiling exhaustion (src/lib/integrations/
 * jobs/retry-integration-deliveries.ts), never for a single background
 * retry attempt failing. An explicit, OWNER-initiated test failure is
 * deliberately NOT subject to any ceiling — the whole point of "Send
 * test"/the post-connect test is immediate, accurate feedback right now.
 */

const TEST_MESSAGE_TEXT = "Aqenra Slack integration is connected.";
const MAX_LABEL_LENGTH = 100;

export class IntegrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationValidationError";
  }
}

function sanitizeLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const trimmed = label.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_LABEL_LENGTH ? trimmed.slice(0, MAX_LABEL_LENGTH) : trimmed;
}

export type IntegrationConnectionSummary = {
  id: string;
  provider: string;
  status: string;
  label: string | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  updatedAt: Date;
};

/**
 * Safe projection only (locked spec §9/§12) — an explicit `select`, never
 * a bare findUnique returning every column, so encryptedCredential/
 * credentialKeyVersion can never accidentally reach a caller two edits
 * from now just because a new column was added to the model.
 */
export async function getIntegrationConnectionSummary(organizationId: string): Promise<IntegrationConnectionSummary | null> {
  return prisma.integrationConnection.findUnique({
    where: { organizationId_provider: { organizationId, provider: SLACK_PROVIDER } },
    select: {
      id: true,
      provider: true,
      status: true,
      label: true,
      connectedAt: true,
      disconnectedAt: true,
      lastErrorCode: true,
      lastErrorAt: true,
      updatedAt: true,
    },
  });
}

export type SaveSlackWebhookResult =
  | { ok: true; testWarning: string | null }
  | { ok: false; error: string };

/**
 * Connect (no existing connection, or reconnecting from DISCONNECTED/
 * ERROR) and Replace (already CONNECTED) both call this one function.
 * Sequence (locked spec §13 step A-E): validate synchronously (no
 * network) -> encrypt -> persist inside one transaction (provisionally
 * CONNECTED, regardless of Slack's live availability right now, so an
 * outage never blocks configuration) -> commit -> exactly one bounded
 * live test send, reusing the identical low-level send path "Send test"
 * itself uses. A test failure never rolls back the just-saved connection
 * — it flips status to ERROR with lastErrorCode populated instead,
 * giving the OWNER honest, immediate feedback.
 */
export async function saveSlackWebhook(params: {
  organizationId: string;
  actorId: string;
  actorName: string;
  webhookUrl: string;
  label: string | null;
}): Promise<SaveSlackWebhookResult> {
  const validation = validateSlackWebhookUrl(params.webhookUrl.trim());
  if (!validation.valid) {
    return { ok: false, error: describeSlackWebhookUrlRejection(validation.reason) };
  }

  const label = sanitizeLabel(params.label);

  let encrypted: ReturnType<typeof encryptCredential>;
  try {
    encrypted = encryptCredential(validation.canonicalUrl, { organizationId: params.organizationId, provider: SLACK_PROVIDER });
  } catch (err) {
    if (err instanceof IntegrationCredentialCryptoError) {
      return { ok: false, error: "Slack integration is not configured on this deployment yet." };
    }
    throw err;
  }

  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.integrationConnection.findUnique({
        where: { organizationId_provider: { organizationId: params.organizationId, provider: SLACK_PROVIDER } },
        select: { id: true, status: true },
      });

      const commonData = {
        status: CONNECTION_STATUS.CONNECTED,
        label,
        encryptedCredential: encrypted.ciphertext,
        credentialKeyVersion: encrypted.keyVersion,
        connectedAt: now,
        disconnectedAt: null,
        lastErrorCode: null,
        lastErrorAt: null,
      };

      if (!existing) {
        const created = await tx.integrationConnection.create({
          data: { organizationId: params.organizationId, provider: SLACK_PROVIDER, ...commonData },
          select: { id: true },
        });
        await createActivity(tx, {
          organizationId: params.organizationId,
          actorId: params.actorId,
          entityType: "INTEGRATION_CONNECTION",
          entityId: created.id,
          action: "CREATED",
          metadata: buildIntegrationConnectionMetadata({ provider: SLACK_PROVIDER, actorName: params.actorName }),
        });
        return;
      }

      await tx.integrationConnection.update({ where: { id: existing.id }, data: commonData });

      if (existing.status === CONNECTION_STATUS.DISCONNECTED || existing.status === CONNECTION_STATUS.ERROR) {
        await createActivity(tx, {
          organizationId: params.organizationId,
          actorId: params.actorId,
          entityType: "INTEGRATION_CONNECTION",
          entityId: existing.id,
          action: "STATUS_CHANGED",
          metadata: buildIntegrationConnectionMetadata({
            provider: SLACK_PROVIDER,
            actorName: params.actorName,
            from: existing.status,
            to: CONNECTION_STATUS.CONNECTED,
          }),
        });
      } else {
        await createActivity(tx, {
          organizationId: params.organizationId,
          actorId: params.actorId,
          entityType: "INTEGRATION_CONNECTION",
          entityId: existing.id,
          action: "UPDATED",
          metadata: buildIntegrationConnectionMetadata({ provider: SLACK_PROVIDER, actorName: params.actorName }),
        });
      }
    });
  } catch (err) {
    // A genuine concurrent double-submit (two "Connect" requests racing
    // on the first-ever row for this org+provider) hits the
    // @@unique([organizationId, provider]) constraint on the losing
    // transaction's own create — Postgres's own unique index is what
    // actually prevents any bad data state here; this is a low-stakes,
    // OWNER-only, single-row race (unlike the Team Ownership/Roles
    // Permissions races this app hardened elsewhere, nothing here can
    // produce a lost invariant or write-skew, only a rejected duplicate
    // insert), so a clean "try again" is the right response rather than
    // an advisory-lock retry loop.
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002") {
      return { ok: false, error: "This organization's Slack connection was just changed by someone else. Please try again." };
    }
    throw err;
  }

  // Post-commit, exactly one bounded live test send — never inside the
  // transaction above (locked spec §20: no network call inside a
  // business/persistence transaction).
  const testResult = await attemptLiveSlackSend(validation.canonicalUrl);
  if (testResult.ok) {
    return { ok: true, testWarning: null };
  }

  await markConnectionError({
    organizationId: params.organizationId,
    actorId: params.actorId,
    actorName: params.actorName,
    errorCode: testResult.code,
  });

  return {
    ok: true,
    testWarning:
      "Saved, but the test message could not be delivered. The connection is marked with an error — check the webhook URL or Slack workspace and try Send test again.",
  };
}

export type DisconnectResult = { ok: true } | { ok: false; error: string };

/**
 * Locked spec §15/§33. Idempotent: disconnecting an already-DISCONNECTED
 * (or nonexistent) connection is a clean no-op, no duplicate Activity.
 * Cancels every non-terminal IntegrationDelivery row for this connection
 * in the SAME transaction — a delivery already claimed (PROCESSING) by
 * the retry worker at the exact moment this commits is marked CANCELED
 * too, but a worker whose HTTP call is already in flight cannot be
 * stopped: its own eventual completion write is a conditional update
 * matched on `status = 'PROCESSING'` (src/lib/integrations/jobs/
 * retry-integration-deliveries.ts), so once this transaction has already
 * moved that row to CANCELED, the worker's own write simply matches zero
 * rows and is silently skipped — the row stays CANCELED, never
 * "un-canceled" by a race. This is the documented, accepted limitation:
 * a message already in flight at the moment of disconnect may still
 * reach Slack even though its own delivery row now reads CANCELED.
 */
export async function disconnectSlackIntegration(params: {
  organizationId: string;
  actorId: string;
  actorName: string;
}): Promise<DisconnectResult> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId: params.organizationId, provider: SLACK_PROVIDER } },
      select: { id: true, status: true },
    });
    if (!existing || existing.status === CONNECTION_STATUS.DISCONNECTED) {
      return; // Idempotent no-op — nothing to disconnect, no Activity.
    }

    await tx.integrationConnection.update({
      where: { id: existing.id },
      data: {
        status: CONNECTION_STATUS.DISCONNECTED,
        encryptedCredential: null,
        credentialKeyVersion: null,
        disconnectedAt: new Date(),
        lastErrorCode: null,
        lastErrorAt: null,
      },
    });

    await tx.integrationDelivery.updateMany({
      where: { integrationConnectionId: existing.id, status: { in: ["PENDING", "FAILED", "PROCESSING"] } },
      data: { status: "CANCELED", nextAttemptAt: null, lockedAt: null },
    });

    await createActivity(tx, {
      organizationId: params.organizationId,
      actorId: params.actorId,
      entityType: "INTEGRATION_CONNECTION",
      entityId: existing.id,
      action: "STATUS_CHANGED",
      metadata: buildIntegrationConnectionMetadata({
        provider: SLACK_PROVIDER,
        actorName: params.actorName,
        from: existing.status,
        to: CONNECTION_STATUS.DISCONNECTED,
      }),
    });
  });

  return { ok: true };
}

export type SendTestResult = { ok: true } | { ok: false; error: string };

/**
 * Locked spec §16. Never creates an IntegrationDelivery row or a business
 * Activity beyond the connection's own STATUS_CHANGED (only when the
 * test's outcome actually changes connection status) — this is a manual,
 * unretried, connection-health probe, not a notified business event.
 */
export async function sendSlackTestMessage(params: {
  organizationId: string;
  actorId: string;
  actorName: string;
}): Promise<SendTestResult> {
  const connection = await prisma.integrationConnection.findUnique({
    where: { organizationId_provider: { organizationId: params.organizationId, provider: SLACK_PROVIDER } },
    select: { id: true, status: true, encryptedCredential: true, credentialKeyVersion: true },
  });

  if (!connection || connection.status === CONNECTION_STATUS.DISCONNECTED || !connection.encryptedCredential || connection.credentialKeyVersion === null) {
    return { ok: false, error: "Connect Slack before sending a test message." };
  }

  let webhookUrl: string;
  try {
    webhookUrl = decryptCredential(connection.encryptedCredential, connection.credentialKeyVersion, {
      organizationId: params.organizationId,
      provider: SLACK_PROVIDER,
    });
  } catch {
    await markConnectionError({
      organizationId: params.organizationId,
      actorId: params.actorId,
      actorName: params.actorName,
      errorCode: "SLACK_CREDENTIAL_DECRYPT_FAILED",
    });
    return { ok: false, error: "Could not read the stored Slack connection. Try reconnecting." };
  }

  // Revalidate immediately before sending (locked spec §8/§21) — never
  // trust a previously-stored value without re-checking it still passes
  // every rule this validator enforces today.
  const revalidation = validateSlackWebhookUrl(webhookUrl);
  if (!revalidation.valid) {
    await markConnectionError({
      organizationId: params.organizationId,
      actorId: params.actorId,
      actorName: params.actorName,
      errorCode: "SLACK_CREDENTIAL_INVALID",
    });
    return { ok: false, error: "The stored Slack connection is no longer valid. Try reconnecting." };
  }

  const result = await attemptLiveSlackSend(revalidation.canonicalUrl);

  if (result.ok) {
    if (connection.status === CONNECTION_STATUS.ERROR) {
      await clearConnectionError({ organizationId: params.organizationId, actorId: params.actorId, actorName: params.actorName });
    }
    return { ok: true };
  }

  await markConnectionError({
    organizationId: params.organizationId,
    actorId: params.actorId,
    actorName: params.actorName,
    errorCode: result.code,
  });
  return { ok: false, error: "The test message could not be delivered. Check the webhook URL or Slack workspace." };
}

/** Shared low-level "send one live test message" used by both saveSlackWebhook's own post-commit test and sendSlackTestMessage above — one code path, never two. */
async function attemptLiveSlackSend(webhookUrl: string): Promise<{ ok: true } | { ok: false; code: IntegrationErrorCode }> {
  const outcome = await sendSlackMessage(webhookUrl, TEST_MESSAGE_TEXT);
  if (outcome.outcome === "success") return { ok: true };
  return { ok: false, code: outcome.code };
}

/**
 * Flips CONNECTED -> ERROR (or refreshes lastErrorCode/At if already
 * ERROR, without a duplicate Activity — locked spec §24: "Do not create
 * Activity for every attempt"). Exported so the delivery worker (src/lib/
 * integrations/jobs/retry-integration-deliveries.ts) can call this exact
 * same function for its own "full retry-ceiling exhaustion" / "definitely
 * permanent failure" ERROR triggers (locked spec §10 reason (b)) — one
 * write path for every legitimate ERROR trigger, never a second copy.
 * `actorId: null` + `actorName: "Aqenra"` for a system/worker-triggered
 * transition (no Staff/User actor exists) — the same null-actorId +
 * metadata.actorName fallback format-activity.ts's own actorLabel
 * resolution already relies on for Contract's portal-acceptance case.
 */
export async function markConnectionError(params: {
  organizationId: string;
  actorId: string | null;
  actorName: string;
  errorCode: IntegrationErrorCode;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId: params.organizationId, provider: SLACK_PROVIDER } },
      select: { id: true, status: true },
    });
    if (!existing || existing.status === CONNECTION_STATUS.DISCONNECTED) return; // Disconnected concurrently — nothing to mark.

    const now = new Date();
    await tx.integrationConnection.update({
      where: { id: existing.id },
      data: { status: CONNECTION_STATUS.ERROR, lastErrorCode: params.errorCode, lastErrorAt: now },
    });

    if (existing.status !== CONNECTION_STATUS.ERROR) {
      await createActivity(tx, {
        organizationId: params.organizationId,
        actorId: params.actorId,
        entityType: "INTEGRATION_CONNECTION",
        entityId: existing.id,
        action: "STATUS_CHANGED",
        metadata: buildIntegrationConnectionMetadata({
          provider: SLACK_PROVIDER,
          actorName: params.actorName,
          from: existing.status,
          to: CONNECTION_STATUS.ERROR,
        }),
      });
    }
  });
}

/** Flips ERROR -> CONNECTED after a successful manual test (locked spec §24: "Successful later Send Test: ERROR -> CONNECTED"). */
async function clearConnectionError(params: { organizationId: string; actorId: string; actorName: string }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId: params.organizationId, provider: SLACK_PROVIDER } },
      select: { id: true, status: true },
    });
    if (!existing || existing.status !== CONNECTION_STATUS.ERROR) return;

    await tx.integrationConnection.update({
      where: { id: existing.id },
      data: { status: CONNECTION_STATUS.CONNECTED, lastErrorCode: null, lastErrorAt: null },
    });

    await createActivity(tx, {
      organizationId: params.organizationId,
      actorId: params.actorId,
      entityType: "INTEGRATION_CONNECTION",
      entityId: existing.id,
      action: "STATUS_CHANGED",
      metadata: buildIntegrationConnectionMetadata({
        provider: SLACK_PROVIDER,
        actorName: params.actorName,
        from: CONNECTION_STATUS.ERROR,
        to: CONNECTION_STATUS.CONNECTED,
      }),
    });
  });
}
