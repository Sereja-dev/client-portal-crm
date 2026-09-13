"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Portal-specific wrapper around the same Supabase sign-out used by staff
 * (@/app/(dashboard)/actions.ts) — that action is generic internally, but
 * its redirect target is hardcoded to /login, which is wrong here. A
 * portal identity must always land back on /portal/login, never /login.
 */
export async function portalSignOut() {
  const supabase = await createClient();
  // Sign-out scope hardening — see (dashboard)/actions.ts's signOut() for
  // the full rationale; same "plain Sign out button, no all-devices
  // promise" reasoning applies symmetrically here.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/portal/login");
}
