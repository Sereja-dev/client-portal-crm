import { describe, expect, it, vi } from "vitest";

/**
 * Stage 6.2.1 fix — regression guard.
 *
 * Root cause (see the stage's diagnosis report): both the Server
 * Component/Action layer's Supabase client and Edge Middleware's had
 * `autoRefreshToken` implicitly enabled (the @supabase/supabase-js
 * default), letting each independently refresh the same session.
 * Supabase rotates the refresh token on every refresh, so whichever call
 * lost that race presented an already-invalidated refresh token, failed,
 * and cleared the session — surfacing as redirect("/login") after a
 * successful-looking Server Action.
 *
 * This does not attempt to simulate real refresh-token rotation (that
 * needs a live Supabase Auth server — see the diagnosis report's own
 * production-like reproduction instead). It only asserts the one thing a
 * unit test *can* prove without a live network call: that
 * createClient() configures the real @supabase/ssr client with
 * autoRefreshToken disabled, so this client never arms its own
 * background refresh timer — the actual mechanism that raced
 * middleware's — while persistSession/detectSessionInUrl are left at
 * their defaults (live reproduction showed disabling persistSession
 * broke this client's own on-demand refresh from persisting its
 * rotated cookies, turning the race into an outright save failure).
 */

const createServerClient = vi.fn(() => ({
  auth: {
    async getUser() {
      return { data: { user: null }, error: null };
    },
  },
}));

vi.mock("@supabase/ssr", () => ({ createServerClient }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

describe("src/lib/supabase/server.ts createClient() — Stage 6.2.1 auth options", () => {
  it("disables autoRefreshToken, and only autoRefreshToken, on the real Supabase client", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    await createClient();

    expect(createServerClient).toHaveBeenCalledTimes(1);
    const [, , options] = createServerClient.mock.calls[0] as unknown as [string, string, { auth: Record<string, unknown> }];
    expect(options.auth).toEqual({ autoRefreshToken: false });
  });
});
