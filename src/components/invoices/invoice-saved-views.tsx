"use client";

import { SavedViewsControl } from "@/components/list/saved-views-control";
import { buildInvoiceHrefFromSavedViewParams } from "@/app/(dashboard)/invoices/saved-view";

/**
 * Tables Improvement Slice D1 — thin Invoice-specific integration of the
 * shared SavedViewsControl. Exists only so `buildInvoiceHrefFromSavedViewParams`
 * (a plain function) can be imported directly into client-side code and
 * handed to SavedViewsControl as a prop — a Server Component (the
 * Invoices page) cannot pass a function prop across the Server/Client
 * boundary, so this one-hop "use client" wrapper is what makes that
 * legal: InvoicesPage passes only plain, serializable data
 * (`organizationId`/`userId`/`currentParams`) into this component, which
 * then supplies the function itself from its own client-side import.
 */
export function InvoiceSavedViews({
  organizationId,
  userId,
  currentParams,
}: {
  organizationId: string;
  userId: string;
  currentParams: Record<string, string>;
}) {
  return (
    <SavedViewsControl
      organizationId={organizationId}
      userId={userId}
      surface="invoices"
      currentParams={currentParams}
      buildApplyHref={buildInvoiceHrefFromSavedViewParams}
    />
  );
}
