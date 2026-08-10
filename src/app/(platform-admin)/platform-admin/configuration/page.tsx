import type { Metadata } from "next";
import { getPlatformLegalConfig } from "@/lib/legal/platform-config";
import { DetailSection, Field } from "@/components/platform-admin/detail-section";

export const metadata: Metadata = {
  title: "Configuration — Platform Admin",
};

/**
 * Sale-Ready Phase D, D1 (Platform Configuration — approved plan).
 * Read-only for this phase, deliberately — see the plan's own framing:
 * this is a Phase D scoping decision, not a claim that env-var-only
 * configuration is this module's permanent shape. Every section's data
 * comes from one small, typed reader (getPlatformLegalConfig() here,
 * unchanged from PR2.1) returning a plain object the page renders via
 * DetailSection/Field — never process.env read inline — so a future
 * editable Platform Configuration service can change what's *behind*
 * each reader without this page changing at all.
 *
 * Legal Configuration is the only real section in D1 — it's the one
 * goal already fully built (PR2.1), so this PR only has to surface it.
 * Branding (D2), Email (D3), Billing (D4), Domain & Deployment (D5), and
 * Environment (D6) each add one more DetailSection call in a later PR,
 * never a redesign of this page.
 */
export default async function PlatformAdminConfigurationPage() {
  const legal = getPlatformLegalConfig();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Configuration</h1>
        <p className="mt-1 text-sm text-gray-600">
          Platform-wide settings for the operator of this Service — separate from any organization&rsquo;s own
          settings.
        </p>
      </div>

      <DetailSection id="legal" title="Legal Configuration">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Legal name" value={legal.legalName} />
          <Field label="Jurisdiction" value={legal.jurisdiction} />
          <Field label="Registered address" value={legal.legalAddress ?? "Not set"} />
          <Field label="Support email" value={legal.supportEmail ?? "Not set"} />
          <Field label="Privacy Policy effective date" value={legal.privacyEffectiveDate} />
          <Field label="Terms of Service effective date" value={legal.tosEffectiveDate} />
        </dl>
      </DetailSection>
    </div>
  );
}
