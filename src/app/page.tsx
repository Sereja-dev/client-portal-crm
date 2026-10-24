import Link from "next/link";
import { siteConfig } from "@/config/site";
import { AuthShell } from "@/components/auth/auth-shell";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";

const PRIMARY_BUTTON_CLASSES =
  "bg-accent text-white hover:bg-accent-hover focus-visible:ring-focus-ring inline-flex w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Pre-Auth Redesign, Slice A — the splash landing, now on the same fixed
 * dark shell every other pre-auth route uses (previously the one
 * surface still on the pre-design-system `bg-gray-50` literal palette).
 * Content unchanged in substance: the exact existing `siteConfig.description`
 * copy, Sign in / Create an account — just restructured onto the shared
 * primary-CTA-then-secondary-link pattern Login/Signup/Forgot/Reset all
 * already use, instead of two side-by-side buttons.
 */
export default function Home() {
  return (
    <AuthShell topRightAction={{ label: "Sign in", href: "/login" }}>
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
          {siteConfig.name}
        </h1>
        <p className="text-text-secondary mt-3 text-base">{siteConfig.description}</p>
      </div>

      <div className="mt-8 space-y-4">
        <Link href="/signup" className={PRIMARY_BUTTON_CLASSES}>
          Create account
        </Link>
        <p className="text-text-secondary text-center text-sm">
          Already have an account?{" "}
          <Link href="/login" className={ACTION_LINK_CLASSES}>
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
