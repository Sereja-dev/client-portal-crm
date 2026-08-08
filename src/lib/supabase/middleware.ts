import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseCookieOptions } from "./cookie-options";
import { TEST_MODE } from "@/lib/test-mode";

export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });

  // TEST_MODE has no real Supabase Auth session to refresh — the test
  // identity cookie (see src/lib/test-mode.ts) isn't a Supabase session
  // and needs no token-refresh call. Without this, every request would
  // make a real network call to NEXT_PUBLIC_SUPABASE_URL, which has no
  // real Auth service listening in this sandbox (see the Stage 4 report).
  if (TEST_MODE) {
    return response;
  }

  return updateRealSupabaseSession(request, response);
}

async function updateRealSupabaseSession(request: NextRequest, initialResponse: NextResponse) {
  let response = initialResponse;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: getSupabaseCookieOptions(),
      // Stage 6.2.1 fix: disables the SDK's proactive background refresh
      // timer, not the on-demand refresh auth.getUser() below already
      // performs when it finds the session stale — that behavior is
      // unchanged, and middleware remains the only place a refresh
      // happens. The timer this disables is scheduled per client
      // instance and isn't tied to this request's lifecycle; on a warm
      // serverless/edge isolate it could fire during a later, unrelated
      // request and write cookies from a stale closure, racing the
      // Server Component/Action layer's own client and corrupting its
      // session. See src/lib/supabase/server.ts for the matching change.
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Revalidates the token against Supabase Auth (and refreshes it if
  // expired) rather than trusting the cookie payload alone.
  await supabase.auth.getUser();

  return response;
}
