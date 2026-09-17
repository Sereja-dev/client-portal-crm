import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { listIndustryPresets, summarizeIndustryPreset } from "@/lib/industry-presets/catalog";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { StatusBadge } from "@/components/ui/status-badge";

/**
 * Industry Presets V1 — Settings → Industry Presets, the main listing
 * page (locked spec §5/§6/§19). Open to any Staff role (OWNER/ADMIN/
 * MEMBER) — everyone may see the catalog and preview a preset; only
 * selecting a card and reaching the Apply button is where the OWNER/
 * ADMIN-only boundary actually applies (see the [presetKey] detail
 * page's own comment, and src/lib/industry-presets/authorization.ts).
 * Never a top-level Staff sidebar feature like Calendar — this lives
 * under Settings, using the existing settings-nav.tsx pattern, matching
 * Custom Fields/Custom Statuses/Lead Capture Forms' own "org-wide
 * config, open to any staff role" tier.
 *
 * A preset gives a workspace a SAFE STARTING configuration for its
 * industry — never a different product mode, and never destructive: see
 * the [presetKey] detail page for the full "will not be changed or
 * removed" copy required at preview time (locked spec §20).
 */
export default async function IndustryPresetsSettingsPage() {
  const { organizationId } = await getCurrentMembership();

  // At most one PresetApplication can ever exist per organization
  // (organizationId is @unique -- see that model's own schema doc
  // comment), so a plain findUnique replaces the old findMany.
  const application = await prisma.presetApplication.findUnique({
    where: { organizationId },
    select: { presetKey: true, createdAt: true },
  });
  const hasAnyApplication = application !== null;

  const presets = listIndustryPresets();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Industry Presets</h1>
      <p className="text-text-secondary mt-1 text-sm">
        Give your workspace a starter configuration for your industry — a preset only adds statuses,
        fields, and tags. Nothing existing is ever changed or removed, and you can keep editing
        everything afterward from its own Settings page.
      </p>
      {hasAnyApplication && (
        <p className="text-text-muted mt-2 text-sm">
          Your workspace already has a preset applied. Industry Presets V1 supports one applied
          preset per workspace — switching to a different preset isn&apos;t supported yet, but every
          setting it created stays fully editable.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {presets.map((preset) => {
          const summary = summarizeIndustryPreset(preset);
          const appliedAt = application?.presetKey === preset.key ? application.createdAt : null;
          return (
            <Link
              key={preset.key}
              href={`/settings/industry-presets/${preset.key}`}
              className={`focus-visible:ring-focus-ring block p-5 transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${CARD_SURFACE_CLASSES}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-text-primary text-base font-semibold">{preset.displayName}</h2>
                {appliedAt && <StatusBadge status="COMPLETE" label="Applied" />}
              </div>
              <p className="text-text-secondary mt-1 text-sm">{preset.description}</p>
              <p className="text-text-muted mt-3 text-xs">
                {summary.statusCount} statuses · {summary.fieldCount} fields · {summary.tagCount} tags
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
