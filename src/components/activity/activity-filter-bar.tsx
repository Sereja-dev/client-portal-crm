import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AutoSubmitSelect } from "@/components/list/auto-submit-select";
import { formatStatusLabel } from "@/lib/format";
import { ACTIVITY_ENTITY_TYPES } from "@/app/(dashboard)/(insights)/activity/query";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { MobileFilterDisclosure } from "@/components/list/mobile-filter-disclosure";

type Member = { id: string; name: string; email: string };

const ACTION_GROUP_OPTIONS = [
  { value: "data", label: "Data changes" },
  { value: "invitations", label: "Invitations" },
  { value: "team", label: "Team" },
];

/**
 * Mobile Improvement Slice B2 — single consumer (/activity only), so
 * this wraps MobileFilterDisclosure directly rather than needing an
 * opt-in prop the way the shared SearchFilterBar does. No Search field
 * exists on this surface — same reasoning as TimeEntryFilterBar's own
 * identical B2 comment: the submit button and Clear link stay outside
 * the disclosure, only the five field controls collapse.
 *
 * B2 duplicate-action remediation — see TimeEntryFilterBar's own
 * identical comment: the submit button is labeled "Apply", not
 * "Filter", since it predates B2 and does something completely
 * different from the disclosure's own generic "Filter"/"Filter (N)"
 * summary (submit vs. expand/collapse) — both reading "Filter" read as
 * one confusing, possibly-duplicate control at mobile width.
 */
export function ActivityFilterBar({
  entityType,
  actionGroup,
  actorId,
  dateFrom,
  dateTo,
  members,
  hasActiveFilters,
  mobileActiveFilterCount,
}: {
  entityType: string;
  actionGroup: string;
  actorId: string;
  dateFrom: string;
  dateTo: string;
  members: Member[];
  hasActiveFilters: boolean;
  mobileActiveFilterCount: number;
}) {
  return (
    <form
      method="GET"
      action="/activity"
      className={`mt-6 flex flex-wrap items-end gap-4 p-4 ${CARD_SURFACE_CLASSES}`}
    >
      <div className="flex items-center gap-3">
        <Button type="submit">Apply</Button>
        {hasActiveFilters && (
          <Link href="/activity" className={ACTION_LINK_CLASSES}>
            Clear
          </Link>
        )}
      </div>

      <MobileFilterDisclosure activeCount={mobileActiveFilterCount}>
        <div className="w-40">
          <label htmlFor="entityType" className="text-text-secondary block text-sm font-medium">
            Entity
          </label>
          <AutoSubmitSelect id="entityType" name="entityType" defaultValue={entityType}>
            <option value="">All entities</option>
            {ACTIVITY_ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {formatStatusLabel(type)}
              </option>
            ))}
          </AutoSubmitSelect>
        </div>

        <div className="w-40">
          <label htmlFor="actionGroup" className="text-text-secondary block text-sm font-medium">
            Category
          </label>
          <AutoSubmitSelect id="actionGroup" name="actionGroup" defaultValue={actionGroup}>
            <option value="">All categories</option>
            {ACTION_GROUP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </AutoSubmitSelect>
        </div>

        <div className="w-52">
          <label htmlFor="actorId" className="text-text-secondary block text-sm font-medium">
            Member
          </label>
          <AutoSubmitSelect id="actorId" name="actorId" defaultValue={actorId}>
            <option value="">All members</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </AutoSubmitSelect>
        </div>

        <div className="w-40">
          <label htmlFor="dateFrom" className="text-text-secondary block text-sm font-medium">
            From
          </label>
          <Input id="dateFrom" name="dateFrom" type="date" defaultValue={dateFrom} />
        </div>

        <div className="w-40">
          <label htmlFor="dateTo" className="text-text-secondary block text-sm font-medium">
            To
          </label>
          <Input id="dateTo" name="dateTo" type="date" defaultValue={dateTo} />
        </div>
      </MobileFilterDisclosure>
    </form>
  );
}
