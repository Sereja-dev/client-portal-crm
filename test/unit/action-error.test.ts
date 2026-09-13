import { describe, expect, it, vi } from "vitest";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { isStaleServerActionError, callActionWithStaleRecovery, STALE_ACTION_MESSAGE } from "@/lib/action-error";

/**
 * Portal stale Server Action hardening — src/lib/action-error.ts itself
 * had no direct test coverage anywhere in the repo before this file
 * (confirmed by search), even though it's already used by every Staff
 * useActionState-driven form hardened since Dashboard-navigation
 * hardening. Covers the classifier and the wrapper's own contract:
 * realm-neutral (no Staff/Portal import anywhere in this module),
 * narrow (only a recognized stale-action shape matches), never masks a
 * redirect or a real domain error, never retries, and invokes the
 * wrapped action exactly once per call.
 *
 * The `UnrecognizedActionError` case is the one this module's own real
 * correctness bug fix added: it's what every real `useActionState`/
 * `startTransition`-driven Server Action call in this app actually
 * throws client-side for an unrecognized action id (verified against
 * this repo's own installed Next.js source — see action-error.ts's own
 * updated doc comment) — the literal "Failed to find Server Action..."
 * string is still real, but only for the legacy no-JS MPA form-fallback
 * path this app never takes.
 */
describe("isStaleServerActionError", () => {
  it("matches Next's own UnrecognizedActionError — the shape a real fetch-based Server Action call actually throws in this app", () => {
    const error = new UnrecognizedActionError('Server Action "abc123" was not found on the server.');
    expect(isStaleServerActionError(error)).toBe(true);
  });

  it("matches the literal Next.js stale-deployment message (the legacy no-JS MPA fallback shape)", () => {
    const error = new Error(
      "Failed to find Server Action. This request might be from an older or newer deployment.",
    );
    expect(isStaleServerActionError(error)).toBe(true);
  });

  it("matches when the literal text is a substring of a longer message", () => {
    const error = new Error("some wrapper: Failed to find Server Action, more context");
    expect(isStaleServerActionError(error)).toBe(true);
  });

  it("does not match a normal domain error", () => {
    expect(isStaleServerActionError(new Error("This tag could not be found."))).toBe(false);
    expect(isStaleServerActionError(new Error("Write something before adding a note."))).toBe(false);
  });

  it("does not match a non-Error value", () => {
    expect(isStaleServerActionError("Failed to find Server Action")).toBe(false);
    expect(isStaleServerActionError(null)).toBe(false);
    expect(isStaleServerActionError(undefined)).toBe(false);
    expect(isStaleServerActionError({ message: "Failed to find Server Action" })).toBe(false);
  });
});

describe("callActionWithStaleRecovery", () => {
  it("returns STALE_ACTION_MESSAGE for the real shape a fetch-based Server Action call throws (UnrecognizedActionError)", () => {
    const action = vi.fn(async () => {
      throw new UnrecognizedActionError('Server Action "abc123" was not found on the server.');
    });
    return callActionWithStaleRecovery(action).then((result) => {
      expect(result).toEqual({ error: STALE_ACTION_MESSAGE });
    });
  });

  it("returns STALE_ACTION_MESSAGE for the legacy literal-message shape too, dropping any prior fieldErrors", () => {
    const action = vi.fn(async () => {
      throw new Error("Failed to find Server Action. This request might be from an older or newer deployment.");
    });
    return callActionWithStaleRecovery(action).then((result) => {
      expect(result).toEqual({ error: STALE_ACTION_MESSAGE });
    });
  });

  it("rethrows a non-stale error unchanged — including a redirect()-shaped control-flow error, never masking it", async () => {
    class FakeRedirectError extends Error {
      digest = "NEXT_REDIRECT;push;/portal/login?reason=session_expired;307";
    }
    const redirectError = new FakeRedirectError("NEXT_REDIRECT");
    const action = vi.fn(async () => {
      throw redirectError;
    });

    await expect(callActionWithStaleRecovery(action)).rejects.toBe(redirectError);
  });

  it("rethrows a normal domain error unchanged, never reclassified as stale", async () => {
    const domainError = new Error("This request is not available.");
    const action = vi.fn(async () => {
      throw domainError;
    });

    await expect(callActionWithStaleRecovery(action)).rejects.toBe(domainError);
  });

  it("passes a successful result through unchanged", async () => {
    const action = vi.fn(async () => ({ error: null }));
    await expect(callActionWithStaleRecovery(action)).resolves.toEqual({ error: null });
  });

  it("invokes the wrapped action exactly once per call — no automatic retry, whether it succeeds, fails normally, or is stale", async () => {
    const success = vi.fn(async () => ({ error: null }));
    await callActionWithStaleRecovery(success);
    expect(success).toHaveBeenCalledTimes(1);

    const stale = vi.fn(async () => {
      throw new Error("Failed to find Server Action. This request might be from an older or newer deployment.");
    });
    await callActionWithStaleRecovery(stale);
    expect(stale).toHaveBeenCalledTimes(1);

    const domain = vi.fn(async () => {
      throw new Error("Some other failure.");
    });
    await callActionWithStaleRecovery(domain).catch(() => undefined);
    expect(domain).toHaveBeenCalledTimes(1);
  });
});
