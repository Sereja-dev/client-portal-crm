import { redirect } from "next/navigation";
import { getVerifiedAuthUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserOrganization, getOrganizationSwitcherItems } from "@/lib/current-user";
import { getRecentNotifications, getUnreadNotificationCount } from "@/lib/notifications/queries";
import { getDisabledInAppTypes } from "@/lib/notifications/preferences";
import { formatNotification } from "@/lib/notifications/format-notification";
import type { NotificationBellItem } from "@/components/notifications/notification-bell";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { TEST_MODE } from "@/lib/test-mode";
import { isAiAssistantAvailable } from "@/lib/ai/providers/provider-factory";
import { ThemePreferenceReconciler } from "@/components/theme/theme-preference-reconciler";
import { dbThemeModeToRuntimeMode } from "@/lib/theme/db-mode";

const RECENT_NOTIFICATIONS_LIMIT = 10;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Stage 6.2.1: shares one request-scoped auth.getUser() call with
  // getOrCreateUser() below (getCurrentUserOrganization ->
  // getOrCreateUser) instead of each making its own independent network
  // round-trip — see getVerifiedAuthUser()'s own doc comment for why
  // that redundancy was causing spurious session-loss after mutations.
  const user = await getVerifiedAuthUser();

  if (!user) {
    redirect("/login");
  }

  // A Client Portal-only identity (a PortalUser with no staff Membership)
  // must never fall through to getOrganizationSwitcherItems() below — that
  // chain (via getCurrentUserOrganization) auto-provisions a brand-new
  // personal Organization for anyone with no existing Membership, which
  // would silently hand a portal user their own empty CRM instead of
  // routing them to their actual portal. This check is deliberately a
  // lightweight existence query, not a reimplementation of that
  // resolution logic — everything below is unchanged.
  const hasMembership = await prisma.membership.findFirst({
    where: { userId: user.id },
    select: { id: true },
  });

  if (!hasMembership) {
    const portalUser = await prisma.portalUser.findUnique({
      where: { id: user.id },
      select: { id: true },
    });
    if (portalUser) {
      redirect("/portal");
    }
    // Neither a Membership nor a PortalUser exists — this is the existing
    // "brand new staff signup" case, which must keep auto-provisioning a
    // User and personal Organization exactly as it already does below.
  }

  // organizationId/recipientId (user.id) here are the only ones the
  // notification queries below ever use — both server-resolved, never from
  // client input.
  const { user: currentUser, organizationId } = await getCurrentUserOrganization();

  // A small (at most 6 rows), separately-fetched preference lookup — kept
  // out of the Promise.all below so it can be threaded into both
  // notification queries as excludeTypes, rather than each of them (or this
  // one) re-fetching the same preference set a second time.
  const excludeTypes = await getDisabledInAppTypes(currentUser.id);

  const [organizations, unreadNotificationCount, recentNotificationRows] = await Promise.all([
    getOrganizationSwitcherItems(),
    getUnreadNotificationCount({ organizationId, recipientId: currentUser.id, excludeTypes }),
    getRecentNotifications({
      organizationId,
      recipientId: currentUser.id,
      limit: RECENT_NOTIFICATIONS_LIMIT,
      excludeTypes,
    }),
  ]);

  const recentNotifications: NotificationBellItem[] = recentNotificationRows.map((row) => ({
    id: row.id,
    ...formatNotification({
      type: row.type,
      metadata: row.metadata,
      entityId: row.entityId,
      createdAt: row.createdAt,
      readAt: row.readAt,
    }),
  }));

  // AI Assistant staff drawer/UI batch. A synchronous, side-effect-free
  // boolean read (see provider-factory.ts's own doc comment) — the exact
  // same source of truth the Route Handler itself gates on, so the UI's
  // notion of "available" can never drift from the API's. Only this
  // boolean crosses the server/client boundary below (via Header ->
  // AiAssistantTrigger) — never TEST_MODE, provider identity, or any
  // other config/env detail.
  const aiAssistantAvailable = isAiAssistantAvailable();

  return (
    // Design System page migration Batch 2 — bg-gray-50 replaced with
    // bg-surface-recessed: globals.css's own token comment names "page
    // gutter" as one of surface-recessed's intended consumers, alongside
    // Sidebar (already migrated in PR #151, and already this same
    // token) — so this wrapper now reads as visually continuous with the
    // Sidebar's own gutter tone, exactly the Round 3 layered-surface
    // hierarchy (recessed gutter/chrome, opaque cards floating on top).
    // This was the root cause of every Batch-1 "temporary literal text"
    // exception: page-owned headings/text render directly on this
    // wrapper with no card of their own, so as long as it stayed raw
    // light-only, a theme-aware light-in-dark text color here produced
    // light-on-light. See each Batch-1 file's own cleanup in this PR.
    <div className="bg-surface-recessed flex min-h-screen flex-col md:flex-row">
      {/*
        Aqenra Theme Persistence Phase C2 — authenticated DB -> cookie/
        runtime reconciliation. currentUser already carries themeMode as
        a plain scalar column (getOrCreateUser()'s own no-`select`
        findUnique/upsert already returns every column), so this is zero
        extra queries, not a new one. Organization switching never
        touches this: themeMode lives on User, not Membership/
        Organization, and this component only ever reads the prop below.
      */}
      <ThemePreferenceReconciler mode={dbThemeModeToRuntimeMode(currentUser.themeMode)} />
      <Sidebar disablePrefetch={TEST_MODE} />
      {/*
        min-w-0: at the md breakpoint this becomes a flex row item next to
        the now-fixed-width Sidebar. Flex items default to `min-width:
        auto`, so without this override the item refuses to shrink below
        its content's intrinsic width — including a wide Table's own
        `overflow-x-auto` wrapper, which can only actually clip/scroll
        once its ancestor chain has somewhere to shrink to. Same root
        cause class as header.tsx's own min-w-0 fix (see that file).
      */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          email={user.email ?? ""}
          organizations={organizations}
          unreadNotificationCount={unreadNotificationCount}
          recentNotifications={recentNotifications}
          aiAssistantAvailable={aiAssistantAvailable}
        />
        {/*
          Design/polish: staff-app main content max-width. main itself
          keeps its existing flex-1/p-6 responsibility unchanged; only a
          new inner mx-auto max-w-7xl wrapper is added around children, so
          content is centered and bounded on wide desktop viewports while
          staying full-width (the cap never engages) on anything narrower
          — matching the bounded-content convention Client Portal
          ((app)/layout.tsx) and Platform Admin ((platform-admin)/
          layout.tsx) already use, at a wider cap (7xl vs their 5xl) since
          staff screens carry wider tables and denser operational content.
          No individual page was touched — every existing page.tsx's own
          className continues to apply inside this wrapper exactly as
          before.
        */}
        <main className="flex-1 p-6">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
