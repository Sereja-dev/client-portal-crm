"use client";

import { useEffect } from "react";
import { useUnsavedChangesScope } from "./unsaved-changes-scope";

/**
 * Forms Improvement Slice C1a — the one line each guarded form
 * (InvoiceForm/RecurringInvoiceForm/QuoteForm) needs to report its own
 * already-computed semantic `isDirty` boolean into the nearest
 * `UnsavedChangesScope`, if any. A no-op when rendered without a Scope
 * ancestor (every existing direct-render unit test, and any future
 * caller that doesn't opt into this protection) — the form's own public
 * prop signature never needs a new prop for this.
 */
export function useReportDirtyState(isDirty: boolean): void {
  const scope = useUnsavedChangesScope();
  useEffect(() => {
    scope?.setIsDirty(isDirty);
  }, [isDirty, scope]);
}
