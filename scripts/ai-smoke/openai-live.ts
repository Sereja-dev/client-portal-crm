/**
 * AQENRA — real OpenAI live smoke runner (entry point).
 *
 * Operator-only, local-only. The ONLY file in this runner that imports
 * the real merged production adapter
 * (src/lib/ai/providers/openai.ts). It does nothing except:
 *   1. check the explicit opt-in gate (scripts/ai-smoke/openai-smoke-core.ts)
 *      BEFORE constructing anything;
 *   2. construct the real adapter with the operator's key;
 *   3. hand it to runSmoke() and print the sanitized report.
 *
 * It must be run with the `react-server` export condition so
 * `import "server-only"` (which the adapter and its dependencies carry)
 * resolves to a no-op instead of throwing — see package.json's
 * `ai:smoke:openai` script and docs/ai-assistant-openai-smoke.md.
 *
 * Guarantees, enforced here and by
 * scripts/security-checks/check-ai-smoke-runner-security.mjs:
 *   - never reads a generic OPENAI_API_KEY (only AQENRA_OPENAI_API_KEY,
 *     via the shared core gate);
 *   - never prints, prefixes, measures, or hashes the key;
 *   - never enumerates the environment;
 *   - no Prisma / Supabase / app tool registry / orchestration import;
 *   - the adapter is the only thing that performs an HTTP request;
 *   - at most MAX_PROVIDER_REQUESTS (3) billed requests, never re-issued.
 *
 * NOT a benchmark. NOT production enablement. Running this may incur a
 * very small OpenAI charge.
 */

import { createOpenAiProvider } from "../../src/lib/ai/providers/openai";
import {
  SMOKE_API_KEY_ENV,
  categorizeError,
  evaluateGate,
  formatReport,
  gateRefusalMessage,
  runSmoke,
} from "./openai-smoke-core";

async function main(): Promise<number> {
  const gate = evaluateGate(process.env);
  if (!gate.ok) {
    // Printed to stderr; nothing sensitive — see gateRefusalMessage().
    console.error(gateRefusalMessage(gate.reason));
    return gate.reason === "missing_opt_in" ? 3 : 4;
  }

  // Safe: the gate has already confirmed this is a non-empty string, and
  // the value is passed straight into the adapter without inspection.
  const apiKey = process.env[SMOKE_API_KEY_ENV] as string;

  const provider = createOpenAiProvider(apiKey);
  const report = await runSmoke(provider);
  console.log(formatReport(report));
  return report.classification === "PASS" ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    // Normalized category only — never the raw error, message, or stack.
    console.error(`AQENRA OPENAI LIVE SMOKE — aborted: ${categorizeError(err)}`);
    process.exitCode = 1;
  });
