import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getGeneratedSubdomain } from "@/lib/organization-setup/domain-settings";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";

/**
 * Customer Setup Wizard (Stage 6.2). Every member may view (same "read
 * open" boundary as Company Profile) — the generated subdomain is
 * unremarkable, already an effectively public fact (the slug it's
 * derived from is already visible in the org switcher). Staff-only by
 * construction, same as every other page under (dashboard).
 *
 * Unfinished Features Cleanup (Block 17) — this page previously also
 * rendered a custom-domain editable input/save form (OWNER-only) and a
 * read-only custom-domain status display (everyone else): both removed
 * per Product decision, since no DNS/domain verification or routing of
 * any kind exists anywhere in this app (see upsertDomainSettings()'s own
 * doc comment in src/lib/organization-setup/domain-settings.ts, and
 * OrganizationDomainSettings's own schema comment — both unchanged by
 * this slice) — every custom domain a Staff user could previously save
 * here would sit at "Pending" forever with zero real effect. The
 * generated subdomain below is real, always-current, and the only thing
 * this page still shows. `OrganizationDomainSettings`,
 * `DomainVerificationStatus`, `getDomainSettings()`/`upsertDomainSettings()`,
 * `updateDomainSettingsAction`, and Platform Admin's own Configuration-page
 * visibility into this same data are all completely unchanged — this is
 * a Staff-facing UI change only, not a backend removal.
 */
export default async function DomainSettingsPage() {
  const { organizationId } = await getCurrentUserOrganization();
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } });
  const generatedSubdomain = getGeneratedSubdomain(organization.slug);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Domain settings</h1>
      <p className="text-text-muted mt-1 text-sm">Your workspace&apos;s address.</p>

      <div className={`mt-6 space-y-1 p-6 ${CARD_SURFACE_CLASSES}`}>
        <p className="text-text-muted text-xs font-medium">Generated subdomain</p>
        <p className="font-mono text-text-primary text-sm">{generatedSubdomain}</p>
      </div>
    </div>
  );
}
