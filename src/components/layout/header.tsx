import { signOut, switchOrganizationAction } from "@/app/(dashboard)/actions";
import { OrganizationSwitcher } from "@/components/layout/organization-switcher";
import { NotificationBell, type NotificationBellItem } from "@/components/notifications/notification-bell";
import { GlobalSearch } from "@/components/search/global-search";
import { AiAssistantTrigger } from "@/components/ai/ai-assistant-trigger";
import type { OrganizationSwitcherItem } from "@/lib/current-user";

export function Header({
  email,
  organizations,
  unreadNotificationCount,
  recentNotifications,
  aiAssistantAvailable,
}: {
  email: string;
  organizations: OrganizationSwitcherItem[];
  unreadNotificationCount: number;
  recentNotifications: NotificationBellItem[];
  /** Server-resolved once in (dashboard)/layout.tsx via isAiAssistantAvailable() — see ai-assistant-trigger.tsx's own doc comment for why this is the ONLY AI-related signal this component (or its child) ever receives. */
  aiAssistantAvailable: boolean;
}) {
  const activeOrganizationId = organizations.find((org) => org.isActive)?.organizationId;

  return (
    <header className="border-border-default bg-surface flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
      <OrganizationSwitcher organizations={organizations} action={switchOrganizationAction} />
      {/*
        min-w-0 lets this group actually shrink below its content's
        intrinsic width when the header wraps onto its own row on a
        narrow viewport — flex items default to `min-width: auto`, which
        silently blocks any child's `truncate` from ever taking effect
        and was the real cause of the horizontal overflow this fixes
        (the email span below had nowhere to shrink to).
      */}
      <div className="flex min-w-0 items-center gap-4">
        {/*
          key={activeOrganizationId} forces React to fully unmount and
          remount GlobalSearch (discarding its search state) whenever the
          active organization changes — defense-in-depth alongside the
          search dialog's own modal-blocking (see search-dialog.tsx). No
          new prop/fetch needed: `organizations` (already server-resolved
          in (dashboard)/layout.tsx) already carries the active org's id.
        */}
        <GlobalSearch key={activeOrganizationId} />
        <AiAssistantTrigger available={aiAssistantAvailable} />
        <NotificationBell
          initialUnreadCount={unreadNotificationCount}
          initialNotifications={recentNotifications}
        />
        {/*
          min-w-0 + truncate: an unconstrained-width email (real emails
          run well past 30 characters) was the dominant contributor to
          the header's mobile overflow. Full address is still in the DOM
          (screen readers get it unabridged) and in `title` (hover for
          sighted mouse users) — only the visual line is ever shortened.
        */}
        <span className="text-text-secondary min-w-0 max-w-[7rem] truncate text-sm sm:max-w-[16rem]" title={email}>
          {email}
        </span>
        <form action={signOut} className="shrink-0">
          <button
            type="submit"
            className="border-border-strong text-text-secondary focus-visible:ring-focus-ring rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
