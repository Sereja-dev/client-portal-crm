/**
 * Authenticated Staff Feedback Widget — the ONLY diagnostic context a bug
 * report carries, and how each piece is bounded. Everything here is
 * low-sensitivity by construction and is disclosed to the user in the form:
 *
 *   - the current page's PATH (never its query string or fragment: search
 *     terms and filters can contain private text),
 *   - the submission time (generated on the server, never trusted from the
 *     client),
 *   - the browser/device string the browser sent with the request, and the
 *     viewport size.
 *
 * It never includes cookies, tokens, form contents, record data or anything
 * from localStorage — there is no code path here that could read them.
 */

export const UNAVAILABLE = "(unavailable)";
const ROUTE_MAX_LENGTH = 200;
const USER_AGENT_MAX_LENGTH = 300;
const VIEWPORT_MAX = 10000;

// Path characters only: letters, digits and the usual URL path punctuation.
const SAFE_ROUTE_PATTERN = /^\/[A-Za-z0-9/_\-.~%[\]()@+,:=]*$/;

export function sanitizeRoute(raw: unknown): string {
  if (typeof raw !== "string") return UNAVAILABLE;
  // Drop any query string / fragment BEFORE anything else — they are never reported.
  const path = raw.trim().split(/[?#]/, 1)[0];
  if (!path || path.startsWith("//") || path.length > ROUTE_MAX_LENGTH) return UNAVAILABLE;
  return SAFE_ROUTE_PATTERN.test(path) ? path : UNAVAILABLE;
}

export function sanitizeUserAgent(raw: unknown): string {
  if (typeof raw !== "string") return UNAVAILABLE;
  let out = "";
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  out = out.trim().slice(0, USER_AGENT_MAX_LENGTH);
  return out || UNAVAILABLE;
}

function parseViewportDimension(raw: unknown): number | null {
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= VIEWPORT_MAX ? n : null;
}

export type BugDiagnostics = {
  route: string;
  submittedAt: string;
  userAgent: string;
  viewport: string;
};

export function buildBugDiagnostics(
  input: { route?: unknown; viewportWidth?: unknown; viewportHeight?: unknown },
  context: { userAgent: unknown; now: Date },
): BugDiagnostics {
  const width = parseViewportDimension(input.viewportWidth);
  const height = parseViewportDimension(input.viewportHeight);
  return {
    route: sanitizeRoute(input.route),
    submittedAt: context.now.toISOString(),
    userAgent: sanitizeUserAgent(context.userAgent),
    viewport: width !== null && height !== null ? `${width} × ${height}` : UNAVAILABLE,
  };
}
