import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentMembership } from "@/lib/current-user";
import { previewIndustryPreset, type PresetItemDecision } from "@/lib/industry-presets/preview";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApplyPresetButton } from "@/components/industry-presets/apply-preset-button";
import { applyIndustryPresetAction } from "../actions";

/**
 * Industry Presets V1 — one preset's preview + Apply (locked spec §6/§8/
 * §20). Server-derived from this organization's real, current data via
 * previewIndustryPreset — every ADD/SKIP decision below is authoritative,
 * never a client-generated guess. Open to any Staff role (view/preview);
 * the Apply button itself is only ever rendered when
 * `preview.canApply` is true, and applyIndustryPresetAction/
 * applyIndustryPreset both independently re-verify the OWNER/ADMIN gate
 * server-side regardless — a MEMBER hitting this exact page still only
 * ever sees the preview, never a working Apply control, and could not
 * make the underlying action succeed even by hand-crafting a request.
 *
 * No implementation jargon anywhere in this page's own copy (no
 * "PresetApplication", "transaction", "natural key", "Prisma",
 * "idempotency" — locked spec §20): "Will add" / "Will skip", "Applied",
 * "preset switching isn't supported yet".
 */
export default async function IndustryPresetDetailPage({ params }: { params: Promise<{ presetKey: string }> }) {
  const { presetKey } = await params;
  const { organizationId, membership } = await getCurrentMembership();

  const result = await previewIndustryPreset(organizationId, presetKey, membership.role);
  if (!result.ok) {
    notFound();
  }
  const { preview } = result;

  const boundApplyAction = applyIndustryPresetAction.bind(null, preview.key);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">{preview.displayName}</h1>
          <p className="text-text-secondary mt-1 text-sm">{preview.description}</p>
        </div>
        <Link href="/settings/industry-presets" className={ACTION_LINK_CLASSES}>
          Back
        </Link>
      </div>

      <div className={`mb-6 p-4 text-sm ${CARD_SURFACE_CLASSES}`}>
        <p className="text-text-primary font-medium">
          Applying this preset only adds new configuration. Existing statuses, fields, and tags will
          not be changed or removed.
        </p>
      </div>

      {preview.alreadyApplied && (
        <div className={`mb-6 flex items-center gap-2 p-4 text-sm ${CARD_SURFACE_CLASSES}`}>
          <StatusBadge status="COMPLETE" label="Applied" />
          <span className="text-text-secondary">
            {preview.appliedAt
              ? `Applied on ${preview.appliedAt.toLocaleDateString()}. You can keep editing everything it created from its own Settings page.`
              : "Already applied. You can keep editing everything it created from its own Settings page."}
          </span>
        </div>
      )}

      {!preview.alreadyApplied && preview.existingAppliedPreset && (
        <div className={`mb-6 p-4 text-sm ${CARD_SURFACE_CLASSES}`}>
          <p className="text-text-secondary">
            Your workspace already applied <strong>{preview.existingAppliedPreset.displayName}</strong>.
            Switching to a different preset isn&apos;t supported yet — but every setting it created
            stays fully editable in its own Settings page.
          </p>
        </div>
      )}

      <PreviewSection title="Custom statuses">
        {preview.statuses.map((item) => (
          <PreviewRow key={`${item.entityType}-${item.key}`} label={`${item.label} (${item.entityType.toLowerCase()})`} decision={item.decision} />
        ))}
      </PreviewSection>

      <PreviewSection title="Custom fields">
        {preview.fields.map((item) => (
          <PreviewRow key={`${item.entityType}-${item.key}`} label={`${item.label} (${item.entityType.toLowerCase()})`} decision={item.decision} />
        ))}
      </PreviewSection>

      <PreviewSection title="Tags">
        {preview.tags.map((item) => (
          <PreviewRow key={item.name} label={item.name} decision={item.decision} />
        ))}
      </PreviewSection>

      <div className="mt-6">
        {preview.canApply ? (
          <ApplyPresetButton action={boundApplyAction} presetDisplayName={preview.displayName} />
        ) : !preview.alreadyApplied && !preview.existingAppliedPreset ? (
          <p className="text-text-muted text-sm">You don&apos;t have permission to apply a preset.</p>
        ) : null}
      </div>
    </div>
  );
}

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`mb-4 overflow-hidden ${CARD_SURFACE_CLASSES}`}>
      <h2 className="text-text-primary border-border-default border-b px-4 py-3 text-sm font-semibold">{title}</h2>
      <ul className="divide-border-default divide-y">{children}</ul>
    </div>
  );
}

function PreviewRow({ label, decision }: { label: string; decision: PresetItemDecision }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <span className="text-text-primary break-words">{label}</span>
      {decision === "ADD" ? (
        <StatusBadge status="ACTIVE" label="Will add" />
      ) : (
        <StatusBadge status="SKIPPED" label="Will skip" />
      )}
    </li>
  );
}
