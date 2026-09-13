import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const redirectTo = sanitizeRedirectPath(parseSearchParam(resolvedSearchParams.redirectTo));
  // Staff session-loss fix — set only by redirectToLoginForSessionLoss()
  // (src/lib/auth/staff-session-redirect.ts), never by an ordinary visit
  // to this page, so a plain "/login" never shows this message.
  const sessionExpired = parseSearchParam(resolvedSearchParams.reason) === "session_expired";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(redirectTo);
  }

  return (
    <AuthCard>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-gray-900">
        Sign in
      </h1>
      {sessionExpired && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Your session expired. Sign in again to continue.
        </p>
      )}
      <LoginForm redirectTo={redirectTo} />
    </AuthCard>
  );
}
