import { NextResponse } from "next/server";
import { getAiAssistantRequestContext } from "@/lib/ai/request-context";
import { getAiProviderAdapter, isAiAssistantAvailable } from "@/lib/ai/providers/provider-factory";
import type { MockAiScriptedStep } from "@/lib/ai/providers/mock";
import { runAiAssistantTurn } from "@/lib/ai/orchestrate";
import { validateAiAssistantRequestBody } from "@/lib/ai/request-schema";
import { checkRateLimit, AI_ASSISTANT_LIMIT, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

/**
 * AI Assistant orchestration + Route Handler batch. The one, POST-only,
 * staff-authenticated JSON API for the AI Assistant — modeled directly on
 * /api/search/route.ts's own contract (generic auth errors, no redirect,
 * private/no-store, a plain try/catch around the real work). `message` is
 * the only client-supplied input; `organizationId` is never accepted from
 * the client at all (see getAiAssistantRequestContext()).
 *
 * Flow, strictly in this order:
 *   A. Provider availability / fail-closed gate (isAiAssistantAvailable())
 *      — runs BEFORE auth, so a Production deployment (where this is
 *      always false — see provider-factory.ts's own doc comment) never
 *      pays for a DB round-trip, and, more importantly, so a
 *      mock-produced answer can never reach a real Production user
 *      regardless of anything auth-related. This 503 is deliberately as
 *      generic as every other response below — it must never become a
 *      useful configuration/auth/tenant-existence oracle.
 *   B. Auth (getAiAssistantRequestContext()) — identical 401/403 handling
 *      to search's own route.
 *   C. Rate limit (per staff userId).
 *   D. Content-Type / body validation (request-schema.ts) — before any
 *      provider/orchestration call.
 *   E. Orchestration (runAiAssistantTurn()).
 *   F. Generic response mapping — no internal detail ever reaches the
 *      client body.
 */

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

/**
 * The one fixed, deterministic script this route ever constructs
 * MockAiProvider with (only reachable at all when isAiAssistantAvailable()
 * is true, i.e. TEST_MODE — see provider-factory.ts). Sufficient for this
 * route's own HTTP-contract tests (auth/rate-limit/response-shape/
 * cache-control) — never influenced by the request body, and there is no
 * client-supplied "mockScenario" field anywhere in this schema (see
 * request-schema.ts). Rich orchestration scenarios (tool loops, limits,
 * provider/tool errors) are covered by direct unit/integration tests
 * against runAiAssistantTurn() itself, which construct whatever
 * MockAiProvider script each test needs, with no HTTP layer involved.
 */
const ROUTE_MOCK_SCRIPT: MockAiScriptedStep[] = [
  { kind: "text", text: "This is a mock AI Assistant response for automated testing." },
];

export async function POST(request: Request) {
  // A. Fail-closed gate.
  if (!isAiAssistantAvailable()) {
    return NextResponse.json(
      { error: "The AI Assistant is not available right now." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  // B. Auth.
  const context = await getAiAssistantRequestContext();
  if (!context.ok) {
    const message = context.status === 401 ? "Not authenticated." : "Not authorized.";
    return NextResponse.json({ error: message }, { status: context.status, headers: NO_STORE_HEADERS });
  }

  // C. Rate limit.
  const limitCheck = checkRateLimit(AI_ASSISTANT_LIMIT, context.userId);
  if (limitCheck.limited) {
    // Never the scope name, count, or reset time — RATE_LIMIT_MESSAGE is
    // the one generic string every rate-limited route in this app returns.
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429, headers: NO_STORE_HEADERS });
  }

  // D. Content-Type / body validation.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const validated = validateAiAssistantRequestBody(rawBody);
  if (!validated) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // E. Orchestration, F. generic response mapping.
  try {
    const provider = getAiProviderAdapter(ROUTE_MOCK_SCRIPT);
    const result = await runAiAssistantTurn({
      organizationId: context.organizationId,
      provider,
      userMessage: validated.message,
    });

    if (!result.ok) {
      // Never distinguishes limit_exceeded/timeout/provider_error/
      // invalid_response/empty_answer/ref_leak to the client — every
      // orchestration-level failure kind maps to this one generic message.
      return NextResponse.json(
        { error: "The AI Assistant is temporarily unavailable. Please try again." },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json({ answer: result.answer }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    // Never the real error's message or stack.
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
