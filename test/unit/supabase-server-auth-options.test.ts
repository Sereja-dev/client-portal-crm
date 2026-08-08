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
 * autoRefreshToken/persistSession/detectSessionInUrl all disabled, so
 * this client never arms its own background refresh timer — the actual
 * mechanism that raced middleware's.
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
  it("disables autoRefreshToken/persistSession/detectSessionInUrl on the real Supabase client", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    await createClient();

    expect(createServerClient).toHaveBeenCalledTimes(1);
    const [, , options] = createServerClient.mock.calls[0] as unknown as [string, string, { auth: Record<string, unknown> }];
    expect(options.auth).toEqual({
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    });
  });
});
