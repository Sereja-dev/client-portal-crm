"use client";

import { useRef, useTransition } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { SpinnerIcon } from "@/components/ui/icons";
import { useToast } from "@/components/toast/toast-provider";
import type { OrganizationSwitcherItem } from "@/lib/current-user";

/**
 * Native <details>/<summary> disclosure — same reasoning as ConfirmDialog's
 * native <dialog>: gives a dependency-free popover with no extra library.
 */
export function OrganizationSwitcher({
  organizations,
  action,
}: {
  organizations: OrganizationSwitcherItem[];
  /** switchOrganizationAction — redirects on success, throws on failure. */
  action: (organizationId: string) => Promise<void>;
}) {
  const active = organizations.find((org) => org.isActive);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  if (!active) return null;

  if (organizations.length === 1) {
    return (
      <div className="flex min-w-0 max-w-[10rem] flex-col leading-tight sm:max-w-[16rem]">
        <span className="text-text-primary truncate text-sm font-medium" title={active.name}>
          {active.name}
        </span>
        <span className="text-text-muted truncate text-xs" title={active.slug}>
          {active.slug}
        </span>
      </div>
    );
  }

  function handleSelect(organizationId: string) {
    if (isPending || organizationId === active!.organizationId) return;
    detailsRef.current?.removeAttribute("open");
    startTransition(async () => {
      try {
        // On success this redirects (and never returns) — only the error
        // path needs handling here.
        await action(organizationId);
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : "Failed to switch organization.",
          "error",
        );
      }
    });
  }

  return (
    <details ref={detailsRef} className="group relative">
      <summary
        className="border-border-strong text-text-secondary focus-visible:ring-focus-ring flex max-w-[12rem] cursor-pointer list-none items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed [&::-webkit-details-marker]:hidden"
        aria-disabled={isPending}
      >
        {isPending ? (
          <SpinnerIcon className="h-4 w-4 shrink-0" />
        ) : (
          <span aria-hidden className="text-text-muted">
            ▾
          </span>
        )}
        <span className="truncate">{active.name}</span>
      </summary>
      <div className="border-border-default bg-surface absolute left-0 z-20 mt-2 w-64 rounded-md border py-1 shadow-lg">
        {organizations.map((org) => (
          <button
            key={org.organizationId}
            type="button"
            disabled={isPending}
            onClick={() => handleSelect(org.organizationId)}
            // group/muted (a NAMED group, not plain `group`) — this
            // button sits inside the outer <details className="group
            // relative"> above, which already owns the unnamed `group`
            // marker for its own purposes; a second, unnamed `group`
            // here would make group-hover:* match whenever EITHER
            // ancestor is hovered (confirmed directly: the muted slug
            // below rendered as hovered even at rest, because the
            // mouse was still over the <summary> that opened this
            // panel, and the outer <details> was still technically
            // `:hover`). Naming this one scopes group-hover/muted:*
            // strictly to this exact row.
            className="group/muted flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
          >
            <span className="min-w-0">
              <span className="text-text-primary flex items-center gap-1.5 truncate font-medium">
                {org.isActive && (
                  <span aria-hidden className="text-accent">
                    ✓
                  </span>
                )}
                <span className="truncate">{org.name}</span>
              </span>
              {/* Pre-push review — this item's own hover:bg-[var(--hover)]
                  above is a plain CSS :hover with no JS override, unlike
                  SearchableSelect/search-result-item's state-driven
                  highlight; --text-muted (#737373) against the broadened
                  --hover (#D4D4D4) measures ~3.2:1, below WCAG AA's 4.5:1
                  for this normal-size text. group-hover promotes to
                  --muted-on-hover (globals.css), which is --text-secondary
                  in Light (5.27:1) and byte-identical to --text-muted in
                  Dark (no change there — Dark's hover barely alters the
                  background at all). */}
              <span className="text-text-muted group-hover/muted:text-[var(--muted-on-hover)] block truncate text-xs">
                {org.slug}
              </span>
            </span>
            <span className="shrink-0">
              <StatusBadge status={org.role} />
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}
