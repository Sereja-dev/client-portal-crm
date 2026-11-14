import type { Metadata } from "next";
import { getPublicLeadCaptureForm } from "@/lib/lead-capture-forms/public";
import { PublicLeadCaptureForm } from "@/components/lead-capture-forms/public-lead-capture-form";

/**
 * Public Lead Capture Forms, Phase 1 — the public, unauthenticated page a
 * form's own publicToken resolves to. Mirrors src/app/invite/[token]/page.tsx's
 * own shape: a bare Server Component doing exactly one lookup by token,
 * one generic "not found" branch covering every reason the token doesn't
 * resolve to a live, active form (see getPublicLeadCaptureForm's own doc
 * comment) — never distinguishable from each other, and never any
 * organization-identifying detail rendered anywhere on this page.
 */

export const metadata: Metadata = {
  // Never indexed/crawled or advertised beyond whoever the organization
  // itself shares the link with.
  robots: { index: false, follow: false },
};

/**
 * Sky-Blue/Grayscale Theme Redesign V1 (correction pass) — this page
 * never adopted the shared semantic tokens (globals.css), instead
 * hand-rolling Tailwind's cool-tinted "gray" scale directly
 * (bg-gray-50/border-gray-200/bg-white/text-gray-900/text-gray-600) —
 * found during the owner's own "inventory ALL app-owned light-theme...
 * hardcoded styles" audit. This page renders inside the normal root
 * layout (unlike global-error.tsx, which replaces it and deliberately
 * stays dependency-free), so it has the same access to the token system
 * every other page already uses — now migrated to it.
 */
function FormCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-surface-recessed flex min-h-screen items-center justify-center px-4 py-12">
      <div className="border-border-default bg-surface w-full max-w-md rounded-lg border p-8 shadow-sm">{children}</div>
    </main>
  );
}

export default async function PublicLeadCaptureFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await getPublicLeadCaptureForm(token);

  if (!form) {
    return (
      <FormCard>
        <h1 className="text-text-primary mb-2 text-xl font-semibold tracking-tight">Form not found</h1>
        <p className="text-text-secondary text-sm">This form is not available.</p>
      </FormCard>
    );
  }

  return (
    <FormCard>
      <h1 className="text-text-primary mb-2 text-xl font-semibold tracking-tight">{form.title}</h1>
      {form.description && <p className="text-text-secondary mb-6 text-sm">{form.description}</p>}
      <PublicLeadCaptureForm token={token} fields={form.fields} successMessage={form.successMessage} />
    </FormCard>
  );
}
