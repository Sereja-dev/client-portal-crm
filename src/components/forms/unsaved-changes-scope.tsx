"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type UnsavedChangesContextValue = {
  isDirty: boolean;
  setIsDirty: (dirty: boolean) => void;
};

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

/**
 * Forms Improvement Slice C1a — the one piece of state every guarded
 * form page needs to share between two otherwise-unrelated siblings: the
 * page's own existing Cancel/Back `<Link>` (still rendered by the
 * Server Component page, in its own exact original place — see
 * `UnsavedChangesCancelLink`'s own header comment for why) and the form
 * itself (InvoiceForm/RecurringInvoiceForm/QuoteForm), which is the only
 * thing that actually knows whether the current state materially differs
 * from its own initial baseline.
 *
 * `useContext` returning `null` (no ancestor `UnsavedChangesScope`) is
 * the deliberate, safe default everywhere this context is read —
 * `UnsavedChangesCancelLink` falls back to behaving like a plain,
 * unguarded `Link`, and a form rendered standalone (e.g. a direct-render
 * unit test) simply never calls `setIsDirty`. Neither call site requires
 * a new prop on any form's own public signature.
 *
 * Deliberately NOT a general-purpose navigation/router framework — this
 * context carries exactly one boolean and its setter, is only ever
 * wrapped around one page's own existing header+form region (purely
 * structural; Next.js already supports passing Server Component output
 * as `children` into a Client Component boundary like this one, so no
 * page needs to become a Client Component to use it), and is consumed
 * by exactly two component kinds: the guarded Cancel/Back link, and the
 * one form it wraps.
 */
export function UnsavedChangesScope({ children }: { children: ReactNode }) {
  const [isDirty, setIsDirty] = useState(false);
  useBeforeUnloadGuard(isDirty);

  return <UnsavedChangesContext.Provider value={{ isDirty, setIsDirty }}>{children}</UnsavedChangesContext.Provider>;
}

export function useUnsavedChangesScope(): UnsavedChangesContextValue | null {
  return useContext(UnsavedChangesContext);
}

/**
 * The hard-unload layer — registers the browser's own native
 * `beforeunload` prompt only while `isDirty` is true, and removes it the
 * instant that stops being the case (including on unmount). This is a
 * genuinely separate browser mechanism from the in-app Cancel/Back guard
 * (`UnsavedChangesCancelLink`): an in-app `<Link>`/`router.push`
 * client-side transition never fires `beforeunload` at all (Forms
 * Improvement Slice C1's own readiness audit, §C/§P) — this effect is
 * the ONLY thing that protects against reload, tab/window close, or
 * navigating to a different origin. Browsers own and ignore any custom
 * message text; `event.returnValue` is set only because legacy engines
 * require a truthy value to show their own built-in prompt at all — no
 * custom copy is attempted or promised.
 */
function useBeforeUnloadGuard(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
}
