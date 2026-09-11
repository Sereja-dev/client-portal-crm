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

function FormCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">{children}</div>
    </main>
  );
}

export default async function PublicLeadCaptureFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await getPublicLeadCaptureForm(token);

  if (!form) {
    return (
      <FormCard>
        <h1 className="mb-2 text-xl font-semibold tracking-tight text-gray-900">Form not found</h1>
        <p className="text-sm text-gray-600">This form is not available.</p>
      </FormCard>
    );
  }

  return (
    <FormCard>
      <h1 className="mb-2 text-xl font-semibold tracking-tight text-gray-900">{form.title}</h1>
      {form.description && <p className="mb-6 text-sm text-gray-600">{form.description}</p>}
      <PublicLeadCaptureForm token={token} fields={form.fields} successMessage={form.successMessage} />
    </FormCard>
  );
}
