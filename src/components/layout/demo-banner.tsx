/**
 * Demo Vs Real Workspace Separation. Renders only when the server has
 * already confirmed (Organization.isDemo, read via
 * isActiveOrganizationDemo() in (dashboard)/layout.tsx — the caller, never
 * this component) that the active organization is a demo/sample workspace
 * — never a client-only guess, never derived from name/slug text. Fully
 * absent (not hidden via CSS) for every real organization, and this
 * component is imported only from the Staff dashboard layout — Portal
 * ((app)/layout.tsx) and Platform Admin ((platform-admin)/layout.tsx)
 * neither import nor render it.
 *
 * Same border-{tone} + bg-{tone}-subtle + text-{tone} token pattern
 * src/components/billing/notice-banner.tsx already established for a
 * persistent, org-level status banner — warning tone, since this is
 * informational-but-important, never blocking or destructive. Not
 * color-only: role="status" + a leading bold label carries the meaning
 * even without color perception, matching that same precedent.
 */
export function DemoBanner({ isDemo }: { isDemo: boolean }) {
  if (!isDemo) return null;

  return (
    <div
      role="status"
      className="border-warning bg-warning-subtle text-warning w-full border-b px-4 py-2 text-center text-sm"
    >
      <span className="font-semibold">Demo workspace</span>
      <span className="mx-1.5" aria-hidden="true">
        ·
      </span>
      <span>These are sample data. Nothing here belongs to a real customer.</span>
    </div>
  );
}
