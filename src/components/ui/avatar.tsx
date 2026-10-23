/**
 * Sidebar Account Menu V1 — the smallest initials-avatar primitive this
 * app has (none existed before this feature; confirmed by the read-only
 * audit's own exhaustive search). No external image, no upload, no
 * profile feature — purely a derived-text circle, matching the existing
 * `bg-accent text-white` filled-accent convention Button's own `primary`
 * variant already establishes.
 *
 * Deliberately only ever rendered from a server-resolved `User.name` —
 * never user-suppliable HTML, never an external URL.
 */

/**
 * Up to two initials from the first two "words" of a name (split on any
 * run of whitespace). A single-word name (common — many User.name values
 * in this app are just a first name) safely yields one initial, never a
 * crash on `name[1]`. An empty/whitespace-only name (defensive only —
 * `User.name` is a required, non-empty column; this is not expected to
 * be reachable in practice) falls back to "?" rather than rendering an
 * empty circle.
 */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const second = words.length > 1 ? (words[1]?.[0] ?? "") : "";
  const initials = `${first}${second}`.toUpperCase();
  return initials || "?";
}

export function Avatar({ name, className = "h-8 w-8 text-sm" }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`bg-accent inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white ${className}`}
    >
      {getInitials(name)}
    </span>
  );
}
