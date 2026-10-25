"use client";

import { useActionState, useEffect, useState } from "react";
import {
  sendRecoveryPhoneVerificationCodeAction,
  verifyRecoveryPhoneCodeAction,
  type RecoveryPhoneFormState,
} from "@/app/(dashboard)/settings/account/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form-field";

const initialState: RecoveryPhoneFormState = { error: null };
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Phone Recovery, Slice B2 — the Send/Verify OTP flow, split out of
 * RecoveryPhoneSettings. Deliberately NOT remounted when the stored
 * phone changes (see RecoveryPhoneSettings's own doc comment for why):
 * a code-entry box left open through a Replace stays open, and
 * submitting a stale code still runs the real server round-trip, which
 * correctly rejects it — "an old code can't verify a new phone" is a
 * server-side invariant (see verifyRecoveryPhoneCodeAction's own doc
 * comment), never something this component's own local state needs to
 * enforce by resetting itself.
 *
 * Two separate `useActionState` hooks (send, verify) rather than one
 * shared one — unlike Save/Remove in the parent (two intents on the
 * SAME mutation), Send and Verify are genuinely sequential, different-
 * shaped steps that need independent pending/error surfaces: a failed
 * Verify attempt must never clear a successful Send's own "code sent"
 * UI state, which sharing one hook would risk.
 *
 * `codeSent` is derived from `sendState` itself (truthy message, no
 * error) rather than tracked as separate local state — this app's own
 * established "server is the source of truth" discipline (see
 * RecoveryPhoneSettings's own doc comment) extended to this action's
 * own response, not a new pattern.
 */
export function PhoneVerificationControls({ verificationAvailable }: { verificationAvailable: boolean }) {
  const [sendState, sendAction, sendPending] = useActionState(sendRecoveryPhoneVerificationCodeAction, initialState);
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyRecoveryPhoneCodeAction, initialState);
  const [code, setCode] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const codeSent = !sendState.error && !!sendState.message;

  // A real side effect (starting/stopping a wall-clock-driven interval
  // timer) belongs in an effect, not computed during render — render
  // must stay pure (no Date.now(), no setInterval), which is exactly
  // why this isn't instead written as the "adjust state during render"
  // pattern React's own docs suggest for simpler cases. Keyed on
  // `sendState` alone (one dispatch = one new object identity) so this
  // starts a fresh cooldown exactly once per successful send, including
  // the harmless "already verified" response — never the security
  // boundary (see actions.ts's own RECOVERY_PHONE_SEND_CODE_LIMIT doc
  // comment: Twilio Verify's own project/number-level limits and this
  // app's per-user hourly limiter are what actually bound abuse/cost;
  // this only stops a user from mashing the button in the same
  // session).
  useEffect(() => {
    if (sendState.error || !sendState.message) return;

    const deadline = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds(remaining);
    };

    // Every setState call below happens inside a callback (setTimeout/
    // setInterval), never synchronously in the effect body itself — the
    // 0ms timeout is what paints the initial "(30s)" countdown without
    // waiting for setInterval's own first real tick a full second later.
    const immediate = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);

    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, [sendState]);

  if (!verificationAvailable) {
    return (
      <p className="text-text-secondary mt-2 text-sm">
        Not verified — this number cannot be used for account recovery yet. Phone verification will be available
        soon.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      <p className="text-text-secondary text-sm">Verify this number before it can be used for account recovery.</p>

      {!codeSent ? (
        <form action={sendAction}>
          <Button type="submit" variant="secondary" loading={sendPending} className="sm:w-auto">
            {sendPending ? "Sending…" : "Send verification code"}
          </Button>
          {sendState.error && (
            <p role="alert" className="text-danger mt-2 text-sm">
              {sendState.error}
            </p>
          )}
        </form>
      ) : (
        <div className="space-y-3">
          <form
            action={verifyAction}
            className="flex flex-wrap items-end gap-3"
            onSubmit={() => setCode("")}
          >
            <div>
              <FormLabel htmlFor="code">Verification code</FormLabel>
              <Input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                placeholder="123456"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ""))}
                aria-invalid={!!verifyState.error}
                aria-describedby={verifyState.error ? "recovery-phone-verify-error" : undefined}
                className="w-40"
              />
            </div>
            <Button type="submit" loading={verifyPending} className="sm:w-auto">
              {verifyPending ? "Verifying…" : "Verify code"}
            </Button>
          </form>

          {verifyState.error && (
            <p id="recovery-phone-verify-error" role="alert" className="text-danger text-sm">
              {verifyState.error}
            </p>
          )}

          <form action={sendAction}>
            <Button
              type="submit"
              variant="ghost"
              loading={sendPending}
              disabled={sendPending || remainingSeconds > 0}
              className="px-0 sm:w-auto"
            >
              {remainingSeconds > 0 ? `Resend code (${remainingSeconds}s)` : "Resend code"}
            </Button>
          </form>
          {sendState.error && (
            <p role="alert" className="text-danger text-sm">
              {sendState.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
