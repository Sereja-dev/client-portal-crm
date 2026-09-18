/**
 * Integrations V1 (Slack Incoming Webhook only). Rendered by the page
 * itself (never `error.tsx` — Next.js redacts Server Component error
 * messages in production before they'd reach a client error boundary;
 * same reasoning src/components/organization-setup/payment-access-denied.tsx's
 * own doc comment already documents) for a non-OWNER identity. Mirrors
 * that component's exact shape — a stored, decryptable outbound
 * credential is the same tier of sensitive concern Payment Details is.
 */
export function IntegrationsAccessDenied() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div
        role="alert"
        className="border-border-strong bg-surface flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center"
      >
        <h1 className="text-text-primary text-lg font-semibold">Access denied</h1>
        <p className="text-text-secondary mt-2 max-w-sm text-sm">
          Integrations are only available to the organization owner.
        </p>
      </div>
    </div>
  );
}
