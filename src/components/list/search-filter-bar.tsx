import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AutoSubmitSelect } from "@/components/list/auto-submit-select";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { MobileFilterDisclosure } from "@/components/list/mobile-filter-disclosure";

type SelectOption = { value: string; label: string };

export function SearchFilterBar({
  basePath,
  searchValue,
  searchPlaceholder,
  filters = [],
  sort,
  hasActiveParams = false,
  hiddenFields = [],
  clearHref,
  mobileFilterDisclosure,
}: {
  basePath: string;
  searchValue: string;
  searchPlaceholder: string;
  filters?: {
    name: string;
    label: string;
    value: string;
    options: SelectOption[];
  }[];
  sort?: {
    value: string;
    options: SelectOption[];
  };
  hasActiveParams?: boolean;
  /** Rendered as <input type="hidden">s inside this same form — e.g. Leads Pipeline view's `view=pipeline`, so submitting Search/an AutoSubmitSelect filter stays on the current view instead of falling back to the default. */
  hiddenFields?: { name: string; value: string }[];
  /** Where the "Clear" link points — defaults to `basePath` (every existing caller's unchanged behavior). Override when clearing filters should still preserve something basePath alone wouldn't (e.g. `?view=pipeline`). */
  clearHref?: string;
  /**
   * Mobile Improvement Slice B1 — opt-in only. Every existing consumer
   * omits this prop and renders exactly as before, byte-for-byte (the
   * branch below is untouched for that case). When provided, `filters`/
   * `sort`/Clear are wrapped in a MobileFilterDisclosure (collapsible
   * below `md`, always fully visible at `md` and up) while Search and
   * its own Search button stay outside it, unconditionally visible —
   * still the exact same single `<form>`, the exact same field markup
   * (never duplicated), just nested one level deeper for the fields a
   * surface's own Product decision chose to collapse. Never changes
   * which params exist, how they submit, or what Clear resets.
   */
  mobileFilterDisclosure?: { activeCount: number };
}) {
  const secondaryControls = (
    <>
      {filters.map((filter) => (
        <div key={filter.name} className="w-40">
          <label
            htmlFor={filter.name}
            className="text-text-secondary block text-sm font-medium"
          >
            {filter.label}
          </label>
          <AutoSubmitSelect id={filter.name} name={filter.name} defaultValue={filter.value}>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </AutoSubmitSelect>
        </div>
      ))}

      {sort && (
        <div className="w-44">
          <label htmlFor="sort" className="text-text-secondary block text-sm font-medium">
            Sort by
          </label>
          <AutoSubmitSelect id="sort" name="sort" defaultValue={sort.value}>
            {sort.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </AutoSubmitSelect>
        </div>
      )}
    </>
  );

  return (
    <form
      method="GET"
      action={basePath}
      className="border-border-default bg-surface mt-6 flex flex-wrap items-end gap-4 rounded-lg border p-4"
    >
      {hiddenFields.map((field) => (
        <input key={field.name} type="hidden" name={field.name} value={field.value} />
      ))}

      <div className="min-w-48 flex-1">
        <label htmlFor="q" className="text-text-secondary block text-sm font-medium">
          Search
        </label>
        <Input
          id="q"
          name="q"
          type="search"
          defaultValue={searchValue}
          placeholder={searchPlaceholder}
        />
      </div>

      {mobileFilterDisclosure ? (
        <>
          <MobileFilterDisclosure activeCount={mobileFilterDisclosure.activeCount}>
            {secondaryControls}
            {hasActiveParams && (
              <div className="flex items-end">
                <Link href={clearHref ?? basePath} className={ACTION_LINK_CLASSES}>
                  Clear
                </Link>
              </div>
            )}
          </MobileFilterDisclosure>

          <div className="flex items-center gap-3">
            <Button type="submit">Search</Button>
          </div>
        </>
      ) : (
        <>
          {secondaryControls}

          <div className="flex items-center gap-3">
            <Button type="submit">Search</Button>
            {hasActiveParams && (
              <Link
                href={clearHref ?? basePath}
                className={ACTION_LINK_CLASSES}
              >
                Clear
              </Link>
            )}
          </div>
        </>
      )}
    </form>
  );
}
