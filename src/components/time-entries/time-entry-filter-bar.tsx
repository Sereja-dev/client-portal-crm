import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AutoSubmitSelect } from "@/components/list/auto-submit-select";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { MobileFilterDisclosure } from "@/components/list/mobile-filter-disclosure";

/**
 * Time Tracking Phase 2A — the Staff list page's own
 * from/to/project/member/billable filter bar. Byte-for-byte mirror of
 * activity-filter-bar.tsx's own exact shape (plain `method="GET"` form,
 * AutoSubmitSelect for the selects, native date inputs needing an
 * explicit Filter submit) — reused directly rather than the
 * useRouter-based filter pattern Client Requests' own
 * StaffRequestFilters used, since this is the simpler, more idiomatic
 * precedent (see the Phase 2 architecture assessment's own finding).
 * `showArchived`/the "Show archived" toggle is a separate plain link,
 * matching Client Requests' own identical convention — not folded into
 * this same GET form, since it's a view switch, not a filter refinement.
 *
 * Mobile Improvement Slice B2 — single consumer (/time only), so this
 * wraps MobileFilterDisclosure directly rather than needing an opt-in
 * prop the way the shared SearchFilterBar does. No Search field exists
 * on this surface, so — reusing B1's own proven "whatever submits the
 * form stays outside, adjacent and reachable" lesson (the exact class
 * of defect its own Search composition remediation fixed) — the submit
 * button and Clear link stay outside the disclosure, exactly where the
 * Search button lives on every SearchFilterBar B2 surface; only the
 * five field controls collapse.
 *
 * B2 duplicate-action remediation — labeled "Apply", not "Filter": this
 * button predates B2 (it already existed, unlabeled-conflict, as the
 * only way to submit the non-auto-submitting From/To date fields) and
 * the disclosure's own generic "Filter"/"Filter (N)" summary is a
 * completely different action (expand/collapse, never a submit) — both
 * reading "Filter" read as one confusing, possibly-duplicate control at
 * mobile width. Renaming only the submit action keeps the disclosure
 * label consistent with every other B1/B2 surface and changes nothing
 * about either control's real behavior.
 */
export function TimeEntryFilterBar({
  from,
  to,
  projectId,
  userId,
  billable,
  showArchived,
  projects,
  members,
  hasActiveFilters,
  mobileActiveFilterCount,
}: {
  from: string;
  to: string;
  projectId: string;
  userId: string;
  billable: string;
  showArchived: boolean;
  projects: { id: string; name: string }[];
  members: { id: string; name: string }[];
  hasActiveFilters: boolean;
  mobileActiveFilterCount: number;
}) {
  return (
    <form method="GET" action="/time" className={`mt-6 flex flex-wrap items-end gap-4 p-4 ${CARD_SURFACE_CLASSES}`}>
      {showArchived && <input type="hidden" name="archived" value="1" />}

      <div className="flex items-center gap-3">
        <Button type="submit">Apply</Button>
        {hasActiveFilters && (
          <Link href={showArchived ? "/time?archived=1" : "/time"} className={ACTION_LINK_CLASSES}>
            Clear filters
          </Link>
        )}
      </div>

      <MobileFilterDisclosure activeCount={mobileActiveFilterCount}>
        <div className="w-40">
          <label htmlFor="from" className="text-text-secondary block text-sm font-medium">
            From
          </label>
          <Input id="from" name="from" type="date" defaultValue={from} />
        </div>

        <div className="w-40">
          <label htmlFor="to" className="text-text-secondary block text-sm font-medium">
            To
          </label>
          <Input id="to" name="to" type="date" defaultValue={to} />
        </div>

        <div className="w-48">
          <label htmlFor="projectId" className="text-text-secondary block text-sm font-medium">
            Project
          </label>
          <AutoSubmitSelect id="projectId" name="projectId" defaultValue={projectId}>
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </AutoSubmitSelect>
        </div>

        <div className="w-48">
          <label htmlFor="userId" className="text-text-secondary block text-sm font-medium">
            Member
          </label>
          <AutoSubmitSelect id="userId" name="userId" defaultValue={userId}>
            <option value="">All members</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </AutoSubmitSelect>
        </div>

        <div className="w-36">
          <label htmlFor="billable" className="text-text-secondary block text-sm font-medium">
            Billable
          </label>
          <AutoSubmitSelect id="billable" name="billable" defaultValue={billable}>
            <option value="">All</option>
            <option value="true">Billable</option>
            <option value="false">Non-billable</option>
          </AutoSubmitSelect>
        </div>
      </MobileFilterDisclosure>
    </form>
  );
}
