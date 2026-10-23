import Link from "next/link";
import { signOut } from "@/app/(dashboard)/actions";
import { Avatar } from "@/components/ui/avatar";
import { PopoverMenu } from "@/components/ui/popover-menu";
import { RowActionMenuItem } from "@/components/ui/row-action-menu";
import { SignOutIcon } from "@/components/ui/icons";

const MENU_ITEM_CLASSES =
  "focus-visible:ring-focus-ring flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset";

/**
 * Sidebar Account Menu V1 (Product Owner-approved Slice A) — desktop
 * only. The top-right Header no longer owns identity/Sign out at `md`
 * and up (see header.tsx's own doc comment); this is its replacement:
 * a compact avatar+name+email row pinned at the sidebar's own bottom,
 * opening an upward menu built on PopoverMenu (a deliberate sibling of
 * RowActionMenu, not a generalization of it — see that file's own doc
 * comment for why).
 *
 * `name`/`email` are both already-resolved values threaded down from
 * (dashboard)/layout.tsx's own existing getVerifiedAuthUser()/
 * getCurrentMembership() calls — no new query of any kind. Only `name`
 * and `email` cross this boundary; no id, no organizationId, no role.
 *
 * Menu contents are exactly the Product Owner's approved V1 list —
 * Appearance/Notifications/Billing (all existing full pages, unchanged)
 * plus Sign out (the existing signOut() Server Action, unchanged). No
 * Profile link: no such page exists yet (see the read-only audit's own
 * §F) — deliberately not invented here.
 */
export function SidebarAccountMenu({ name, email }: { name: string; email: string }) {
  return (
    <div className="border-border-default hidden border-t p-2 md:block">
      <PopoverMenu label="Account menu" trigger={(triggerProps) => (
        <button
          type="button"
          {...triggerProps}
          className="focus-visible:ring-focus-ring flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <Avatar name={name} />
          <span className="min-w-0 flex-1">
            <span className="text-text-primary block truncate text-sm font-medium">{name}</span>
            <span className="text-text-muted block truncate text-xs" title={email}>
              {email}
            </span>
          </span>
        </button>
      )}>
        <div className="border-border-subtle border-b px-3 py-2">
          <p className="text-text-primary truncate text-sm font-medium">{name}</p>
          <p className="text-text-muted truncate text-xs" title={email}>
            {email}
          </p>
        </div>
        <div className="p-1">
          <RowActionMenuItem>
            <Link href="/settings/appearance" className={MENU_ITEM_CLASSES}>
              Appearance
            </Link>
          </RowActionMenuItem>
          <RowActionMenuItem>
            <Link href="/settings/notifications" className={MENU_ITEM_CLASSES}>
              Notifications
            </Link>
          </RowActionMenuItem>
          <RowActionMenuItem>
            <Link href="/settings/billing" className={MENU_ITEM_CLASSES}>
              Billing
            </Link>
          </RowActionMenuItem>
        </div>
        <div className="border-border-subtle border-t p-1">
          <RowActionMenuItem>
            <form action={signOut}>
              <button type="submit" className={`${MENU_ITEM_CLASSES} text-danger`}>
                <SignOutIcon className="h-4 w-4 shrink-0" />
                Sign out
              </button>
            </form>
          </RowActionMenuItem>
        </div>
      </PopoverMenu>
    </div>
  );
}
