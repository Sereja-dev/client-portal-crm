"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/toast/toast-provider";
import type { IntegrationConnectionSummary } from "@/lib/integrations/connection";
import { saveSlackWebhookAction, disconnectSlackAction, sendSlackTestAction, type SaveSlackWebhookActionState } from "./actions";

/**
 * Integrations V1 (Slack Incoming Webhook only -- architecture lock
 * validation, locked spec §31). The one provider card this page renders.
 * Three states: disconnected (title + explanation + Connect), a form
 * (shared by both Connect and Replace webhook — saveSlackWebhookAction's
 * own doc comment on why one action covers both), and connected/error
 * (badge + optional label + Send test/Replace webhook/Disconnect, never
 * the webhook URL itself in any state).
 */

const SAVE_INITIAL_STATE: SaveSlackWebhookActionState = { error: null };

export function SlackConnectionCard({ connection }: { connection: IntegrationConnectionSummary | null }) {
  const [showForm, setShowForm] = useState(false);
  const [saveState, saveAction, savePending] = useActionState(saveSlackWebhookAction, SAVE_INITIAL_STATE);
  const { showToast } = useToast();
  const disconnectDialogRef = useRef<ConfirmDialogHandle>(null);
  const [disconnectPending, setDisconnectPending] = useState(false);
  const [testPending, setTestPending] = useState(false);

  // "Adjust state during render" (https://react.dev/reference/react/useState
  // #storing-information-from-previous-renders) rather than a useEffect —
  // mirrors this codebase's own comment-composer.tsx precedent of never
  // calling a local setState synchronously inside an effect body. A
  // successful save is detected purely from saveState's own object
  // identity changing to a fresh, message-bearing result while not
  // pending; the form is collapsed back to the read-only connected view
  // in that same render pass, no extra render cycle needed.
  const [prevSaveState, setPrevSaveState] = useState(saveState);
  if (saveState !== prevSaveState) {
    setPrevSaveState(saveState);
    if (!savePending && saveState.message) {
      setShowForm(false);
    }
  }

  // The toast itself IS a genuine external-system side effect (unlike the
  // local setShowForm above), so it belongs in an effect — guarded by the
  // same wasPending-ref pending-transition technique comment-composer.tsx
  // already establishes, so it fires exactly once per completed submit.
  const wasSavePending = useRef(false);
  useEffect(() => {
    if (wasSavePending.current && !savePending && saveState.message) {
      showToast(saveState.message, saveState.message.startsWith("Saved, but") ? "error" : "success");
    }
    wasSavePending.current = savePending;
  }, [savePending, saveState, showToast]);

  const isConnected = connection && connection.status !== "DISCONNECTED";

  async function handleDisconnect() {
    setDisconnectPending(true);
    try {
      const result = await disconnectSlackAction();
      if (result.error) {
        showToast(result.error, "error");
      } else {
        showToast("Slack disconnected.");
      }
    } finally {
      setDisconnectPending(false);
    }
  }

  async function handleSendTest() {
    setTestPending(true);
    try {
      const result = await sendSlackTestAction();
      showToast(result.error ?? "Test message sent.", result.error ? "error" : "success");
    } finally {
      setTestPending(false);
    }
  }

  return (
    <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-text-primary text-base font-semibold">Slack</h2>
          <p className="text-text-secondary mt-1 text-sm">
            Post a message to a Slack channel when a lead comes in, a client is added, an invoice is sent, or a
            contract is signed.
          </p>
        </div>
        {isConnected && <StatusBadge status={connection.status} />}
      </div>

      {isConnected && !showForm && (
        <div className="mt-4 space-y-1 text-sm">
          {connection.label && (
            <p className="text-text-secondary">
              Label: <span className="text-text-primary">{connection.label}</span>
            </p>
          )}
          {connection.connectedAt && (
            <p className="text-text-muted">Connected {connection.connectedAt.toLocaleDateString()}</p>
          )}
          {connection.status === "ERROR" && (
            <p className="text-danger">
              The last delivery or test message could not be sent. Check the webhook URL or Slack workspace, then try
              Send test again.
            </p>
          )}
        </div>
      )}

      {!showForm && (
        <div className="mt-4 flex flex-wrap gap-3">
          {!isConnected && <Button onClick={() => setShowForm(true)}>Connect</Button>}
          {isConnected && (
            <>
              <Button variant="secondary" loading={testPending} disabled={testPending} onClick={handleSendTest}>
                Send test
              </Button>
              <Button variant="secondary" onClick={() => setShowForm(true)}>
                Replace webhook
              </Button>
              <Button
                variant="dangerOutline"
                disabled={disconnectPending}
                onClick={() => disconnectDialogRef.current?.open()}
              >
                Disconnect
              </Button>
            </>
          )}
        </div>
      )}

      {showForm && (
        <form action={saveAction} className="mt-4 space-y-4">
          <FormField label="Label (optional)" htmlFor="label">
            <Input
              id="label"
              name="label"
              type="text"
              placeholder="e.g. #sales-alerts"
              defaultValue={connection?.label ?? ""}
              maxLength={100}
            />
          </FormField>

          <FormField label="Webhook URL" htmlFor="webhookUrl" required>
            <Input
              id="webhookUrl"
              name="webhookUrl"
              type="url"
              autoComplete="off"
              placeholder="https://hooks.slack.com/services/..."
              required
            />
          </FormField>

          <p className="text-text-muted text-xs">
            The URL is stored securely and won&apos;t be shown again. Connecting sends a test message to Slack.
          </p>

          {saveState.error && (
            <p role="alert" className="text-danger text-sm">
              {saveState.error}
            </p>
          )}

          <div className="flex gap-3">
            <Button type="submit" loading={savePending}>
              {savePending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)} disabled={savePending}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        ref={disconnectDialogRef}
        title="Disconnect Slack"
        description="Future queued notifications will be canceled. A message already in flight at the moment of disconnect may still be delivered."
        confirmLabel="Disconnect"
        destructive
        onConfirm={handleDisconnect}
      />
    </div>
  );
}
