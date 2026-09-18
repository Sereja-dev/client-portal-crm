"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/current-user";
import { assertCanManageIntegrations, IntegrationsAccessError } from "@/lib/integrations/authorization";
import { saveSlackWebhook, disconnectSlackIntegration, sendSlackTestMessage } from "@/lib/integrations/connection";

/**
 * Integrations V1 (Slack Incoming Webhook only -- architecture lock
 * validation, locked spec §10). Every action here independently
 * re-verifies OWNER, before touching anything — the page's own check
 * (assertCanManageIntegrations in page.tsx) is never trusted alone, the
 * same "never left to a single call site" discipline
 * src/lib/organization-setup/authorization.ts's own doc comment already
 * documents for Payment Details.
 */

export type SaveSlackWebhookActionState = { error: string | null; message?: string };

/** Connect AND Replace both submit here — src/lib/integrations/connection.ts's own saveSlackWebhook already branches its Activity semantics purely on the connection's pre-existing state, so one Server Action covers both UI entry points. */
export async function saveSlackWebhookAction(
  _prevState: SaveSlackWebhookActionState,
  formData: FormData,
): Promise<SaveSlackWebhookActionState> {
  const { organizationId, membership, user } = await getCurrentMembership();

  try {
    assertCanManageIntegrations(membership.role);
  } catch (err) {
    if (err instanceof IntegrationsAccessError) return { error: err.message };
    throw err;
  }

  const webhookUrl = String(formData.get("webhookUrl") ?? "").trim();
  if (!webhookUrl) {
    return { error: "Enter a Slack webhook URL." };
  }
  const rawLabel = formData.get("label");
  const label = typeof rawLabel === "string" && rawLabel.trim().length > 0 ? rawLabel : null;

  const result = await saveSlackWebhook({
    organizationId,
    actorId: user.id,
    actorName: user.name,
    webhookUrl,
    label,
  });

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/settings/integrations");
  return { error: null, message: result.testWarning ?? "Slack connected. A test message was sent." };
}

export async function disconnectSlackAction(): Promise<{ error: string | null }> {
  const { organizationId, membership, user } = await getCurrentMembership();

  try {
    assertCanManageIntegrations(membership.role);
  } catch (err) {
    if (err instanceof IntegrationsAccessError) return { error: err.message };
    throw err;
  }

  await disconnectSlackIntegration({ organizationId, actorId: user.id, actorName: user.name });
  revalidatePath("/settings/integrations");
  return { error: null };
}

export async function sendSlackTestAction(): Promise<{ error: string | null }> {
  const { organizationId, membership, user } = await getCurrentMembership();

  try {
    assertCanManageIntegrations(membership.role);
  } catch (err) {
    if (err instanceof IntegrationsAccessError) return { error: err.message };
    throw err;
  }

  const result = await sendSlackTestMessage({ organizationId, actorId: user.id, actorName: user.name });
  revalidatePath("/settings/integrations");
  return result.ok ? { error: null } : { error: result.error };
}
