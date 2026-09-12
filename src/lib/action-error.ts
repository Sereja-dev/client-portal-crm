/**
 * Dashboard-navigation hardening (post-audit) — the one shared place a
 * thrown/rejected Server Action error is classified as Next.js's own
 * documented "stale deployment" failure, distinct from a normal thrown
 * domain error (e.g. "This tag could not be found.").
 *
 * Root cause (see node_modules/next/dist/docs/01-app/02-guides/
 * server-actions.md, "Deployment considerations"): each Server Action's
 * id is part of its build artifacts, and a new deployment typically
 * generates new ids even when the source is unchanged. A browser tab
 * that loaded its page from a previous deployment and then invokes a
 * Server Action against the new one gets this exact error, verbatim,
 * thrown server-side (see node_modules/next/dist/server/app-render/
 * action-handler.js's own literal message text, error code E975):
 * "Failed to find Server Action. This request might be from an older or
 * newer deployment." Next's own recommended mitigation is exactly what
 * this module exists to provide: "Surface the error as a retry path in
 * the UI rather than a hard failure, so a refresh recovers the user."
 *
 * Deliberately narrow: this matches ONLY that literal substring, never a
 * generic catch-all — a real domain rejection (FORBIDDEN, NOT_FOUND, a
 * validation message, a genuine network failure) must never be
 * misclassified or swallowed as "stale," and every call site here still
 * re-throws (or falls back to its own existing generic message) for
 * anything that doesn't match.
 */

const STALE_SERVER_ACTION_MARKER = "Failed to find Server Action";

export const STALE_ACTION_MESSAGE = "This page may be out of date. Refresh and try again.";

export function isStaleServerActionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(STALE_SERVER_ACTION_MARKER);
}

/**
 * Wraps one `useActionState`-driven form submission so a stale-deployment
 * failure resolves to a normal `{ error: STALE_ACTION_MESSAGE }` state
 * instead of an uncaught exception reaching the nearest error boundary
 * (Settings' own error.tsx, a generic "Something went wrong" card with no
 * useful recovery copy). Every form-state type in this app shares the
 * same `{ error: string | null; ... }` shape with every other field
 * optional (see e.g. ClientFormState/TagFormState/
 * CustomStatusDefinitionFormState) — `{ error: STALE_ACTION_MESSAGE }` is
 * therefore always a structurally valid `S` on its own, deliberately
 * dropping any stale `fieldErrors`/`customFieldErrors` from a PRIOR
 * attempt rather than spreading `prevState`, so a stale-deployment retry
 * never shows old, unrelated field errors alongside the new banner.
 *
 * Only usable where the caller already controls the async function
 * passed to `useActionState` (every dialog/form in this app either
 * already wraps the raw Server Action in its own async callback, or can
 * trivially do so at the call site) — this is NOT a generic Server
 * Action interceptor, and is never applied where no reliable client-side
 * catch point exists.
 */
export async function callActionWithStaleRecovery<S extends { error: string | null }>(
  action: () => Promise<S>,
): Promise<S> {
  try {
    return await action();
  } catch (error) {
    if (isStaleServerActionError(error)) {
      return { error: STALE_ACTION_MESSAGE } as S;
    }
    throw error;
  }
}
