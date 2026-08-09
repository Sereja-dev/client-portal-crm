import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { requestPasswordReset } from "./actions";

export default async function ForgotPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-gray-900">Forgot your password?</h1>
        <ForgotPasswordForm action={requestPasswordReset} loginPath="/login" />
      </div>
    </main>
  );
}
