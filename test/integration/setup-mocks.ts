import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { getMockAuthUser, setMockAuthUser, consumeMockSignUpConfig, mockCookies } from "../support/auth-mock";
import { mockUploadAttachmentObject, mockRemoveAttachmentObject } from "../support/storage-mock";
import { mockUploadLogoObject, mockRemoveLogoObject } from "../support/logo-storage-mock";
import { mockRedirect, mockNotFound, mockRevalidatePath } from "../support/navigation-mock";

// The ONLY things mocked across the whole integration suite — every one
// of them because the REAL implementation needs an actual Next.js request
// context (AsyncLocalStorage) or a live external network call, neither of
// which plain Vitest provides:
//  - next/headers' cookies()
//  - next/navigation's redirect()/notFound()
//  - next/cache's revalidatePath()
//  - @/lib/supabase/server's createClient() (auth.getUser()/signUp() would
//    need a live Supabase Auth network call — stubbed to whatever
//    test/support/auth-mock.ts's setMockAuthUser()/setMockSignUpConfig()
//    currently holds)
//  - @/lib/storage/attachments-storage (imports "server-only", and its
//    real implementation needs a live Supabase Storage bucket)
//  - @/lib/storage/logo-storage (same reasoning, its own dedicated bucket
//    — see logo-mutations.ts's own doc comment for why it's separate)
// Everything else — getOrCreateUser, getCurrentMembership,
// getCurrentPortalUser, and every real Server Action/query function built
// on them — runs unmodified against the real (test) Postgres via the real
// Prisma client.

vi.mock("next/headers", () => ({
  cookies: async () => mockCookies(),
  // Empty headers — getRequestIp() (src/lib/rate-limit/ip.ts) falls back
  // to its own documented "unknown" bucket when neither x-real-ip nor
  // x-forwarded-for is present, exactly like local dev without Vercel.
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
  revalidateTag: mockRevalidatePath,
}));

vi.mock("@/lib/supabase/server", () => ({
  // Stage 6.2.1: the mocked equivalent of the real getVerifiedAuthUser()
  // — not wrapped in React.cache() here (that only actually memoizes
  // inside a real Next.js request-scoped render, which this integration
  // harness deliberately never provides; verified empirically before
  // writing this comment). Reads through to the same mock auth state
  // getUser() below does, so getOrCreateUser() and any direct caller
  // continue to see identical, consistent behavior in tests.
  getVerifiedAuthUser: async () => {
    const user = getMockAuthUser();
    return user ? { ...user, user_metadata: user.user_metadata ?? {} } : null;
  },
  createClient: async () => ({
    auth: {
      async getUser() {
        const user = getMockAuthUser();
        return { data: { user: user ? { ...user, user_metadata: user.user_metadata ?? {} } : null } };
      },
      async signOut() {
        return { error: null };
      },
      // Sale-Ready Phase B, PR1 (Password Recovery) — resetPasswordCore's
      // own generic call; TEST_MODE has no real password to check either
      // (see src/lib/supabase/server.ts's own updateUser stub), so this
      // just reports success unconditionally.
      async updateUser() {
        return { data: { user: null }, error: null };
      },
      // SaaS Signup Foundation (Stage 6.1) — see setMockSignUpConfig()'s
      // own doc comment for what each configured "kind" simulates.
      async signUp({ email, options }: { email: string; password: string; options?: { data?: Record<string, unknown> } }) {
        const config = consumeMockSignUpConfig();
        if (config.kind === "error") {
          return { data: { user: null, session: null }, error: { message: config.message } };
        }
        const user = { id: config.id ?? randomUUID(), email, user_metadata: options?.data ?? {} };
        if (config.kind === "session") {
          // Mirrors the real SSR client persisting a session cookie that a
          // subsequent getUser() call in the same request then reads back.
          setMockAuthUser(user);
          return { data: { user, session: { access_token: "mock-session-token" } }, error: null };
        }
        return { data: { user, session: null }, error: null };
      },
    },
  }),
}));

vi.mock("@/lib/storage/attachments-storage", () => ({
  uploadAttachmentObject: mockUploadAttachmentObject,
  removeAttachmentObject: mockRemoveAttachmentObject,
}));

vi.mock("@/lib/storage/logo-storage", () => ({
  uploadLogoObject: mockUploadLogoObject,
  removeLogoObject: mockRemoveLogoObject,
}));

// The rate limiter's store is a real module-level singleton Map (see
// src/lib/rate-limit/store.ts) — it would otherwise persist across every
// integration test file in this one process, and a concurrency test
// firing many accept-invite calls at once (test/integration/invitations/
// concurrent-accept.test.ts) would trip the real 20/hour limit as an
// unrelated side effect. Rate-limiting's own logic (allow/block/isolation/
// sweep) is already exhaustively unit-tested in Stage 3 — Stage 4 only
// needs every limit-guarded action to keep working when never limited.
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: () => ({ limited: false }) };
});
