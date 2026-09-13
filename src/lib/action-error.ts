/**
 * Dashboard-navigation hardening (post-audit) — the one shared place a
 * thrown/rejected Server Action error is classified as Next.js's own
 * documented "stale deployment" failure, distinct from a normal thrown
 * domain error (e.g. "This tag could not be found.").
 *
 * Root cause (see node_modules/next/dist/docs/01-app/02-guides/
 * server-actions.md, "Deployment considerations"): each Server Action's
 * id is part of its build artifacts, and a new deployment typically
 * generates new ids even when the source is unchanged. Next's own
 * recommended mitigation is exactly what this module exists to provide:
 * "Surface the error as a retry path in the UI rather than a hard
 * failure, so a refresh recovers the user."
 *
 * Portal stale Server Action hardening — a real correctness bug found
 * while wiring this same module into Portal's forms, verified by
 * reading this repo's own installed node_modules/next/dist/server/
 * app-render/action-handler.js and node_modules/next/dist/client/
 * components/router-reducer/reducers/server-action-reducer.js, and
 * empirically reproduced against the real running app server: every
 * real `useActionState`/`startTransition`-driven Server Action call in
 * this app is a *fetch* action (`isFetchAction`), and EVERY fetch-action
 * branch in action-handler.js that can't resolve the requested action id
 * routes through the same `handleUnrecognizedFetchAction()` helper,
 * which sets the `x-nextjs-action-not-found` response header and
 * returns a generic `"Server action not found."` body — never the
 * literal "Failed to find Server Action..." string this module used to
 * match on alone. On the client, server-action-reducer.js checks that
 * exact header and, when present, throws Next's own `UnrecognizedActionError`
 * instead (message: `Server Action "<id>" was not found on the
 * server....`) — a different string that the old check would never have
 * matched. (The literal "Failed to find Server Action..." text is still
 * real: it's thrown for the legacy, no-JS "MPA" form-submission fallback
 * path, which this app — full client-side JS throughout — never takes.)
 * Next.js ships a purpose-built, `instanceof`-based, version-stable
 * detector for exactly this — `unstable_isUnrecognizedActionError`,
 * publicly re-exported from `next/navigation` — which this module now
 * checks first; the original literal-substring check is kept alongside
 * it (never removed) as a second, independent match for the MPA-fallback
 * case and as defense in depth against a future Next version reverting
 * to that message shape.
 *
 * Deliberately narrow otherwise: a real domain rejection (FORBIDDEN,
 * NOT_FOUND, a validation message, a genuine network failure) must never
 * be misclassified or swallowed as "stale," and every call site here
 * still re-throws (or falls back to its own existing generic message)
 * for anything that doesn't match either check.
 */

import { unstable_isUnrecognizedActionError } from "next/navigation";

const STALE_SERVER_ACTION_MARKER = "Failed to find Server Action";

export const STALE_ACTION_MESSAGE = "This page may be out of date. Refresh and try again.";

export function isStaleServerActionError(error: unknown): boolean {
  if (unstable_isUnrecognizedActionError(error)) {
    return true;
  }
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
