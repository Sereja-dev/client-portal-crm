import type { Instrumentation } from "next";

/**
 * TEMPORARY Leads Pipeline Production RSC diagnostic — Production
 * Observability Correction (Leads Pipeline V1 investigation).
 *
 * This file exists ONLY to capture the original, unredacted server-side
 * exception behind Production's React error #441 / digest 977228107 on
 * the Leads Pipeline route (`/leads?view=pipeline`), which Next.js's own
 * production error handling otherwise redacts before it ever reaches the
 * browser. It must be removed entirely once that one diagnostic capture
 * has happened — see this same header's own removal note below.
 *
 * `onRequestError` is Next.js's own official, stable-since-15.0.0 hook
 * (confirmed directly against the installed 16.3.2 docs/types, not
 * assumed from another version — see
 * node_modules/next/dist/server/instrumentation/types.d.ts for the exact
 * installed signature this file matches). It is observation-only: Next
 * calls it after capturing a server error, but this function's own
 * return value/completion has no effect on how that error is actually
 * handled, rendered, or responded to — nothing here can alter, suppress,
 * retry, or redirect the real request.
 *
 * Deliberately global (Next does not support scoping this hook itself to
 * one route) — the route/render guard below is this file's own,
 * evaluated first, before anything is read from `error` at all. Every
 * other application error in this app (all other pages/Route Handlers/
 * Server Actions) passes through this same function and is guarded out
 * immediately, with zero log emission and zero added work beyond three
 * cheap property reads.
 *
 * REMOVAL: once the one controlled Production capture described in this
 * implementation's own report has happened, this entire file must be
 * deleted (not weakened, not left "just in case") — see that report's
 * own §I retrieval procedure and §K git-discipline note for the exact
 * follow-up commit this obligates.
 */

const DIAGNOSTIC_MARKER = "AQENRA_LEADS_PIPELINE_RSC_DIAGNOSTIC";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 4000;

// Fixed replacement text — every redaction below produces exactly this,
// never a partial/variable-length substitute that could itself leak
// something about the redacted value's own shape.
const REDACTED = "[REDACTED]";

/**
 * A small, conservative set of patterns for values that must never
 * appear in a log line, applied to `message`/`stack` only — never to any
 * other field, and never used to attempt full object serialization.
 * Deliberately ordered so a URL containing embedded credentials is
 * redacted before the plainer email/UUID patterns could otherwise only
 * partially match inside it.
 */
const REDACTION_PATTERNS: RegExp[] = [
  // URI/connection strings carrying embedded credentials, e.g.
  // postgres://user:pass@host/db or https://user:pass@host/path.
  /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s@/]+:[^\s@/]+@[^\s]+/g,
  // JWT-shaped three-segment base64url tokens.
  /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // Obvious secret/token/password/key assignments (key=value or key: value),
  // whatever quoting style — the assigned value is redacted, the key name
  // is kept since it's useful for diagnosis and never sensitive itself.
  /\b((?:api[_-]?key|secret|token|password|passwd|pwd|auth)[a-zA-Z0-9_]*\s*[:=]\s*)(['"]?)[^\s'",;]+\2/gi,
  // Email-shaped strings.
  /\b[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}\b/g,
  // UUID-shaped values (v1-v5 generic shape).
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
  // Very long opaque token-like strings (40+ chars of only
  // alphanumeric/_/-/. with no whitespace) not already caught above —
  // a conservative catch-all for e.g. a raw API key or session id that
  // doesn't match any of the more specific shapes.
  /\b[A-Za-z0-9_.\-]{40,}\b/g,
];

function redact(value: string): string {
  let result = value;
  for (const pattern of REDACTION_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

function sanitizeMessage(message: string): string {
  const truncated = message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message;
  return redact(truncated);
}

function sanitizeStack(stack: string): string {
  const truncated = stack.length > MAX_STACK_LENGTH ? `${stack.slice(0, MAX_STACK_LENGTH)}…` : stack;
  return redact(truncated);
}

/**
 * Reads only the four named, explicitly-approved fields off `error` —
 * never spreads it, never `JSON.stringify(error)`s it, never enumerates
 * its own properties. This is deliberate: a Prisma error can carry a
 * `meta` field with raw query values, and any generic "serialize
 * whatever this object has" approach would leak exactly the kind of
 * data this diagnostic must never log.
 */
function buildDiagnosticPayload(error: unknown): string {
  const isErrorLike = typeof error === "object" && error !== null;

  const name = isErrorLike && "name" in error && typeof (error as { name?: unknown }).name === "string"
    ? (error as { name: string }).name
    : "UnknownError";

  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : isErrorLike && "message" in error && typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : String(error);

  const rawStack =
    isErrorLike && "stack" in error && typeof (error as { stack?: unknown }).stack === "string"
      ? (error as { stack: string }).stack
      : "";

  const rawDigest = isErrorLike && "digest" in error ? (error as { digest?: unknown }).digest : undefined;
  const digest =
    typeof rawDigest === "string" || typeof rawDigest === "number" ? String(rawDigest) : "none";

  const payload = {
    marker: DIAGNOSTIC_MARKER,
    name: redact(name),
    message: sanitizeMessage(rawMessage),
    stack: sanitizeStack(rawStack),
    digest,
  };

  return `${DIAGNOSTIC_MARKER} ${JSON.stringify(payload)}`;
}

export const onRequestError: Instrumentation.onRequestError = (error, _request, context) => {
  // Route/render guard, evaluated first, using only Next's own
  // framework-provided metadata — never headers, cookies, or query
  // values (the second parameter, `_request`, is intentionally never
  // read at all beyond this point). `routePath` is Next's own internal
  // page path (app-render.js's own `ctx.pagePath`, e.g. "/leads" or
  // "/404" — confirmed against the installed source, not assumed);
  // `.includes` rather than an exact `===` guards against a route-group
  // variant of that same value without ever widening to another route.
  if (context.routeType !== "render") return;
  if (context.renderSource !== "react-server-components") return;
  if (!context.routePath.includes("leads")) return;

  // Deliberate, temporary diagnostic output; see this file's own header
  // for the removal plan.
  console.error(buildDiagnosticPayload(error));
};
