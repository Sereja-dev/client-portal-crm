import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Stage 6.2.1 fix — regression guard, middleware side. See
 * test/unit/supabase-server-auth-options.test.ts for the full root-cause
 * writeup shared by both call sites. This asserts the middleware's own
 * client is configured identically — middleware remains the ONLY place a
 * refresh happens (via its own on-demand auth.getUser() call below,
 * which is unaffected by this option — see the inline comment in
 * src/lib/supabase/middleware.ts), and never arms a background timer
 * that could fire outside this request's lifecycle.
 */

const createServerClient = vi.fn(() => ({
  auth: {
    async getUser() {
      return { data: { user: null }, error: null };
    },
  },
}));

vi.mock("@supabase/ssr", () => ({ createServerClient }));

describe("src/lib/supabase/middleware.ts updateSession() — Stage 6.2.1 auth options", () => {
  it("disables autoRefreshToken, and only autoRefreshToken, on the real Supabase client", async () => {
    const { updateSession } = await import("@/lib/supabase/middleware");
    const request = new NextRequest("http://localhost:3000/settings/company", { method: "POST" });
    await updateSession(request);

    expect(createServerClient).toHaveBeenCalledTimes(1);
    const [, , options] = createServerClient.mock.calls[0] as unknown as [string, string, { auth: Record<string, unknown> }];
    expect(options.auth).toEqual({ autoRefreshToken: false });
  });
});
