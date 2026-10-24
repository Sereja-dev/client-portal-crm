import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/auth-shell";
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
    <AuthShell topRightAction={{ label: "Back to sign in", href: "/login" }}>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
        Reset your password
      </h1>
      <ForgotPasswordForm action={requestPasswordReset} loginPath="/login" />
    </AuthShell>
  );
}
