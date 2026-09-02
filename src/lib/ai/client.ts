/**
 * AI Assistant staff drawer/UI batch. The one, client-safe seam between
 * the AI Assistant UI (src/components/ai/**) and the merged backend
 * (POST /api/ai/assistant) — deliberately owns only the wire contract
 * itself, never anything from the server-only orchestration layer.
 *
 * This file must never import from src/lib/ai/orchestrate.ts,
 * providers/**, request-context.ts, tools/**, or Prisma — its own request/
 * response types are hand-written to match the real, merged HTTP
 * contract exactly, never re-exported from AiOrchestrationResult or any
 * other internal server type. If that internal shape ever changes, this
 * file (and its own tests — see test/unit/ai/client.test.ts) is the one
 * place that would need updating, not every UI call site — see this
 * batch's own "API/UI contract drift protection" requirement.
 *
 * Also owns the one generic, product-facing status->copy mapping every
 * error state in the UI renders from — never the raw response body.
 */

const AI_ASSISTANT_ENDPOINT = "/api/ai/assistant";

export type AiAssistantSuccessResult = { ok: true; answer: string };
export type AiAssistantErrorResult = { ok: false; status: number };
export type AiAssistantResult = AiAssistantSuccessResult | AiAssistantErrorResult;

function isValidSuccessBody(value: unknown): value is { answer: string } {
  return typeof value === "object" && value !== null && "answer" in value && typeof (value as { answer: unknown }).answer === "string";
}

/**
 * The one function anything under src/components/ai/** calls to reach
 * the backend. Sends EXACTLY `{ message }` — no organizationId, no
 * history, no provider, no mockScenario, no tool/limit config — the
 * request body a client could ever construct here has no other field to
 * send in the first place (this function's own signature is the only
 * way in). A non-2xx response is normalized to `{ ok: false, status }`
 * — the raw response body (whatever shape it has) is never read, parsed,
 * or surfaced; only the HTTP status code crosses this boundary, mapped
 * to product-facing copy by getAiAssistantErrorCopy() below.
 *
 * A 200 response is still validated at runtime before being trusted —
 * `answer` must genuinely be a string, or this is treated the same as
 * any other malformed/unexpected response (network-shaped failure, `ok:
 * false, status: 0`), never assumed safe just because the status code
 * was 200.
 */
export async function askAiAssistant(message: string, signal?: AbortSignal): Promise<AiAssistantResult> {
  let response: Response;
  try {
    response = await fetch(AI_ASSISTANT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal,
    });
  } catch (error) {
    // A deliberate abort (close/unmount) must propagate as-is so the
    // caller can distinguish it from a genuine network failure and stay
    // silent (see the panel's own abort handling) — everything else
    // (offline, DNS failure, CORS, ...) is normalized to the same
    // network-failure shape the UI already has copy for.
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return { ok: false, status: 0 };
  }

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: response.status };
  }

  if (!isValidSuccessBody(body)) {
    return { ok: false, status: response.status };
  }

  return { ok: true, answer: body.answer };
}

/**
 * Generic, product-facing copy for every status this endpoint can ever
 * return (see route.ts's own error contract) plus `status: 0` for a
 * network-level failure (never reached the server at all). Never
 * exposes the real response body, an internal orchestration error kind,
 * a rate-limit counter/reset time, or any environment/config detail —
 * matches the backend's own generic-error philosophy exactly.
 */
export function getAiAssistantErrorCopy(status: number): string {
  switch (status) {
    case 400:
      return "That message couldn't be sent. Try rephrasing it.";
    case 401:
      return "Your session has expired. Reload the page and sign in again.";
    case 403:
      return "AI Assistant isn't available for this account.";
    case 429:
      return "You've sent a lot of requests. Try again in a little while.";
    case 502:
      return "AI Assistant is temporarily unavailable. Try again in a moment.";
    case 503:
      return "AI Assistant is currently unavailable.";
    case 0:
      return "Couldn't reach the server. Check your connection and try again.";
    default:
      return "Something went wrong. Try again.";
  }
}
