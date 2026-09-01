import type { ReactNode } from "react";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";

/**
 * One consistent wrapper for every read-only section across Platform
 * Admin's detail-style pages (Organization Details, PR3.3; Platform
 * Configuration, Phase D) — a proper landmark (<section>) associated with
 * its own heading via aria-labelledby, and the exact heading level (h2)
 * every section shares. Extracted here (rather than left duplicated in
 * the Organization Details page) the moment a second page needed the
 * exact same shape — the same "don't duplicate a pattern once it's
 * genuinely reused" discipline this whole engagement has followed for
 * queries and config, now applied to a component.
 *
 * Reserves each page's structure for future sections (Organization
 * Details: Health/Billing history/Audit log/Webhooks/Storage/Email
 * delivery; Platform Configuration: whatever a future editable
 * Configuration service adds): each is one more <DetailSection> call,
 * never a redesign. None are rendered as empty placeholders today — a
 * visible "Health" box with no real data would be exactly the kind of
 * invented functionality this app's own legal/dashboard pages have
 * deliberately avoided elsewhere.
 */
export function DetailSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      <h2 id={headingId} className="text-text-primary text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * A single label/value pair inside a DetailSection, rendered as a real
 * <dt>/<dd> pair (the caller wraps a group of these in a <dl>). `value`
 * is deliberately `ReactNode`, not `string` — every current caller
 * renders plain text or a StatusBadge, but this never assumed "text
 * only," so a future editable Configuration service can swap the value
 * slot for a real form control later without this component changing.
 *
 * wrap-anywhere (overflow-wrap: anywhere) on the value: found as a real,
 * user-visible instance of the exact same expected-name-discoverability
 * defect this hotfix exists to fix — Business Identity's own "Display
 * name" Field renders this same Organization.name value (see
 * company-profile.ts's own upsertCompanyProfile, which keeps the two in
 * sync) with no wrap protection at all, and a long/unbroken name
 * overflowed this page horizontally exactly like the header and dialog
 * did before their own fixes. Purely additive: every other Field value
 * in this app (dates, counts, "Not set", badges, links) is short enough
 * that this never visibly changes anything for them.
 */
export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-text-secondary text-xs font-medium">{label}</dt>
      <dd className="text-text-primary mt-0.5 wrap-anywhere text-sm">{value}</dd>
    </div>
  );
}
