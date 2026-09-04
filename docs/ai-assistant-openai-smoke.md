# Real OpenAI Live Smoke — Operator Guide

A tiny, reusable operator script that proves the **merged production
OpenAI adapter** (`src/lib/ai/providers/openai.ts`) can actually talk to
OpenAI: transport, non-streaming completion, and one tool-call
round-trip — using **synthetic data only**.

- **Local / operator smoke only.** Not wired into CI, not run by the app.
- **Not a benchmark.** For provider/model comparison see
  `scripts/ai-provider-eval/` (a separate, isolated harness).
- **Not production enablement.** This never sets `AI_PROVIDER` anywhere,
  never touches Vercel, the database, or Supabase, and never enables the
  Staff AI Assistant in any deployment.
- **Synthetic data only.** No real client names, emails, production
  UUIDs, or customer content ever enter a request.
- **Maximum 3 billed OpenAI requests** for a whole run (scenario A = 1,
  scenario B = 2). A failed request is never re-sent.
- **It may incur a very small OpenAI charge** (a few thousand tokens on
  `gpt-5.6-luna` — well under a cent at the pricing snapshot in
  `scripts/ai-smoke/openai-smoke-core.ts`).

## What it exercises

| Scenario | Billed requests | Proves |
| --- | --- | --- |
| **A — no-tool** | 1 | a real request returns a normalized non-empty **text** `AiResponse` |
| **B — tool-call** | 2 | request 1 returns a normalized **`AiToolCall`** for the exact synthetic tool → the call name/args/value are validated → a hard-coded synthetic tool result is fed back → request 2 returns a normalized **text** answer |

The synthetic tool (`getSyntheticAccountSummary`) is a fictional,
read-only, no-argument-mutation fixture defined entirely in
`scripts/ai-smoke/openai-smoke-core.ts`. It never reads Prisma, the app
tool registry, or any live source; its result is a fixed literal.

Application-level orchestration, tenant-scoped DB tool access, and
adversarial tool security are **not** re-tested here — they are covered
offline by `test/unit/ai/**` and `test/integration/ai/**`.

## Run it

### 1. Create a disposable OpenAI API key

Create a **new, dedicated** key in the OpenAI dashboard for this test.
Do not reuse a shared or production key.

### 2. Export the key into your shell (never on the command line)

```sh
read -rs AQENRA_OPENAI_API_KEY && export AQENRA_OPENAI_API_KEY
```

Paste the key at the silent prompt and press Enter. `read -rs` keeps the
value out of your shell history and off your terminal; a plain
`export AQENRA_OPENAI_API_KEY=sk-...` would be captured by history and is
not acceptable.

This runner reads **only** `AQENRA_OPENAI_API_KEY` — never a generic
`OPENAI_API_KEY`.

### 3. Verify presence (boolean only)

```sh
test -n "${AQENRA_OPENAI_API_KEY:+set}" && echo "key: present" || echo "key: MISSING"
```

Never print, prefix, measure, or hash the value.

### 4. Execute

```sh
AQENRA_OPENAI_SMOKE=1 npm run ai:smoke:openai
```

`AQENRA_OPENAI_SMOKE=1` is the **explicit opt-in** and is scoped to this
one command. Without it the script refuses to run and constructs no
provider. The npm script pins Node's `--conditions=react-server` export
condition so the adapter's `import "server-only"` resolves to a no-op
instead of throwing outside Next's bundler.

### 5. Expected output (sanitized)

```
AQENRA OPENAI LIVE SMOKE — sanitized result
provider: openai
model: gpt-5.6-luna
scenario A (no-tool): PASS  requests=1  tokens(p/c/t)=.../.../...
scenario B (tool-call): PASS  requests=2  tokens(p/c/t)=.../.../...
total provider requests: 3 (hard max 3)
approx cost: ~$0.0000xx USD (pricing snapshot 2026-09-03; reverify before relying on this)
classification: PASS
```

Exit code `0` = `PASS`. Non-zero = a refusal (`3` = no opt-in, `4` = no
key) or a `FAIL` / aborted run (`1`). On failure the script prints a
**normalized category only** (e.g. `provider_rate_limited`,
`unexpected_text_response`, `tool_args_value_not_allowed`) — never a raw
SDK error, prompt, answer, tool argument, tool result, header, request
id, or stack.

If transport works but the model's answer quality is poor, that still
counts as **plumbing verified** — record it as quality evidence; the
script does not re-run.

### 6. Unset the key after the test

```sh
unset AQENRA_OPENAI_API_KEY
```

### 7. Revoke the disposable key

Delete the key in the OpenAI dashboard so it can never be used again.

## Safety properties (enforced)

`scripts/security-checks/check-ai-smoke-runner-security.mjs` (run by
`npm run security:check`) fails the build if a future edit makes the
runner:

- import or construct a second OpenAI adapter, or import the `openai` SDK
  outside the merged `src/lib/ai/providers/openai.ts`;
- read a generic `OPENAI_API_KEY`;
- print or enumerate the environment;
- import Prisma, Supabase, the app tool registry, `provider-factory`, or
  `orchestrate`;
- perform its own `fetch` / HTTP / socket call;
- raise `MAX_PROVIDER_REQUESTS` above `3`, or add retry logic;
- hardcode the model id / `reasoning_effort` / `parallel_tool_calls`
  (these must come only from the merged adapter);
- drop the `--conditions=react-server` launch condition.

Offline behaviour (gate, budget cap, no-retry, abort/timeout,
tool-call validation, output sanitization, no DB dependency) is covered
by `test/unit/ai/openai-smoke-runner.test.ts`.
