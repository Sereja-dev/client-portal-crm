/**
 * Roles / Permissions V1. Rendered by the page itself (never `error.tsx`
 * — Next.js redacts Server Component error messages in production before
 * they'd reach a client error boundary; see
 * src/app/(dashboard)/analytics/page.tsx's own doc comment for the
 * identical reasoning) for a non-OWNER identity, mirroring
 * PaymentAccessDenied's own shape exactly.
 */
export function RolePermissionsAccessDenied() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div
        role="alert"
        className="border-border-strong bg-surface flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center"
      >
        <h1 className="text-text-primary text-lg font-semibold">Access denied</h1>
        <p className="text-text-secondary mt-2 max-w-sm text-sm">
          Roles &amp; permissions are only available to the organization owner.
        </p>
      </div>
    </div>
  );
}
