# Aqenra AI provider benchmark harness

An isolated, **manual-only** tool for comparing Anthropic's Claude Haiku
4.5 against OpenAI's economical model on Aqenra's own six-tool AI
Assistant contract — used to decide which vendor to build the first real
provider adapter against. It is not part of the app, is never installed,
built, or run by Aqenra's own tooling, and never touches Production.

## What this is not

- **Not synthetic-data-only for realism's sake — it is synthetic-data-only
  by hard requirement.** Every client/project/task/invoice in
  `fixtures/organization.ts` is invented for this benchmark. No real
  Aqenra customer or organization data has ever been used here, and none
  ever should be.
- **Not part of the app.** Nothing under `src/**` imports anything from
  this directory, and nothing here imports the app's real Prisma-backed
  tool implementations, `orchestrate.ts`, `provider-factory.ts`, any
  route, or any UI file. See `test/source-isolation.test.ts` for the
  mechanical proof.
- **Not run automatically, ever.** Not by `npm install`, `npm test`,
  `npm run build`, or `npm run security:check` at the repo root, not by
  any CI workflow (`.github/workflows/*.yml` never references this
  directory), and not by this package's own default CLI invocation
  either — see "No live network by default" below.

## Setup

```bash
cd scripts/ai-provider-eval
npm install     # installs @anthropic-ai/sdk and openai — isolated to
                # this directory's own node_modules/package-lock.json;
                # the repo root's own package.json/package-lock.json are
                # never touched.
```

## No live network by default

**Running `npm run eval` (or `npx tsx index.ts`) with no flags makes NO
network call.** It validates the 36 golden cases (`cases.ts`) and runs
the full loop → fixture-tool-execution → scoring → report pipeline
against an offline stub provider (`providers/stub.ts`, which imports
neither `@anthropic-ai/sdk` nor `openai`) to prove the whole pipeline is
wired correctly. A live benchmark against the real vendor APIs requires
the **explicit** `--run` flag. See `test/no-live-by-default.test.ts` for
both a static-source proof (the only references to `providers/anthropic.js`
and `providers/openai.js` anywhere in `index.ts` are inside a dynamic
`await import(...)`, reached only from the `--run` code path) and an
empirical proof (running the CLI with no flags and empty keys never
surfaces a provider-construction error, because that code path is never
reached).

| Command | Network? | What it does |
|---|---|---|
| `npm run eval` / `npm run dry-run` | **No** | Structural validation (36 cases, 12 balanced categories) + a full offline pipeline run against the stub provider |
| `npm run validate` | **No** | Structural validation only |
| `npm run typecheck` | No | `tsc --noEmit` against this package's own isolated `tsconfig.json` |
| `npm test` | No | Node's built-in test runner (`node --test`) over `test/**/*.test.ts` |
| `npm run run` (or `tsx index.ts --run`) | **Yes — live** | The real 216-run benchmark (36 cases × 2 providers × 3 repetitions). Requires both API keys (below). |

## Secret handling

Reads **only**:

- `AQENRA_EVAL_ANTHROPIC_API_KEY`
- `AQENRA_EVAL_OPENAI_API_KEY`

**Never** falls back to a generic `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
— even if one happens to be set in your shell for an unrelated tool, this
harness will not pick it up. Set the two `AQENRA_EVAL_*` variables in
your local shell only:

```bash
export AQENRA_EVAL_ANTHROPIC_API_KEY="..."   # never commit this
export AQENRA_EVAL_OPENAI_API_KEY="..."      # never commit this
```

- Never create a `.env` file for this package — there is no code path
  here that reads one, and this package's own `.gitignore` blocks one
  from ever being committed by accident anyway.
- A missing key produces a clean, local validation error **before** any
  client is constructed or any network call is attempted (`secrets.ts`).
- The key value is never printed, never serialized into a result
  artifact, and never appears in an error message (`secrets.ts`'s own
  `redactPotentialSecrets()` is applied to every string written to
  `results/`, as defense-in-depth on top of every call site's own
  discipline of never logging the raw value).

## Allowed network hosts

Only `api.anthropic.com` and `api.openai.com` — enforced mechanically by
`network-allowlist.ts`, which asserts each SDK's own configured
`baseURL` **before** constructing the client (both SDKs default their
`baseURL` from an environment variable — `ANTHROPIC_BASE_URL` /
`OPENAI_BASE_URL` — if the caller doesn't pass one explicitly, so this
harness always passes the allowed URL explicitly, neutralizing any such
variable a developer's shell happens to have set for something else). No
Supabase URL, no Vercel URL, no Aqenra route, and no environment
variable can override this — see `test/network-allowlist.test.ts`.

## Snapshot refresh procedure

The six tools' `name`/`description`/`inputSchema` live in
`fixtures/tool-contracts.snapshot.json`, extracted from the real
`src/lib/ai/tools/registry.ts` — never hand-retyped. `extract-fixtures.ts`
is the **one** file in this whole package allowed to import that
registry (and, transitively, Prisma) — and only for this extraction; it
never calls `execute()`, queries Prisma directly, authenticates, or makes
any HTTP request. It must be run from the **repository root**, not from
inside this directory, so it can resolve the main app's own `@/*` path
alias and `node_modules`:

```bash
# from the repo root:
npx tsx scripts/ai-provider-eval/extract-fixtures.ts
```

Re-run this whenever a real tool's schema/description changes in the
app. The script fails loudly if the registered tool set ever stops being
exactly the approved six. Its own type-checking lives in a dedicated,
root-context config (also run from the repo root):

```bash
npx tsc -p scripts/ai-provider-eval/tsconfig.extract.json --noEmit
```

## Model IDs and pricing must be reverified before every run

`pricing.ts` hardcodes both model IDs and per-token prices, stamped with
`PRICING_SNAPSHOT_DATE`. **Vendors change model availability and pricing
on their own schedule** — reverify both against current first-party
documentation (`platform.claude.com/docs/en/about-claude/pricing` and
`platform.claude.com/docs/en/about-claude/model-deprecations` for
Anthropic; `developers.openai.com/api/docs/pricing` and
`developers.openai.com/api/docs/models` for OpenAI) before trusting a
live run's own cost figures, and update `pricing.ts` (with a new
`PRICING_SNAPSHOT_DATE`) if anything changed. A stale price is not a
crash — it's a silently wrong cost estimate, which is why every report
artifact prints the snapshot date prominently rather than assuming it.

## Scoring rules frozen before live run

The quality gate, lexicographic comparison, and tie rule
(`decision.ts`) are frozen as approved and must not be weakened in place
after seeing results. A genuine change to any threshold requires a
separate, committed revision to `decision.ts` made and reviewed **before**
the next run — never a quiet edit made because a particular run's numbers
were disappointing.

With the pricing snapshot dated 2026-09-03, OpenAI's `gpt-5.6-luna` is
priced roughly 4–5× cheaper than Anthropic's `claude-haiku-4-5` on this
benchmark's own workload shape. If a live run shows both providers
passing the quality gate with objectively similar tool-correctness/
factuality/policy scores, the frozen tie rule may legitimately select
OpenAI on that cost gap alone (`SELECT_OPENAI`) — this is an intentional,
predeclared consequence of the rule, decided before any run, not a
result to second-guess afterward. See `decision.ts`'s own doc comment.

## API surface choice (OpenAI)

The OpenAI adapter (`providers/openai.ts`) uses the **Chat Completions**
API, not the Responses API — see that file's own header comment for the
full reasoning. In short: `orchestrate.ts`'s own loop is stateless and
resends the complete message history on every call, which maps directly
onto Chat Completions' own stateless design; the Responses API's natural
mode centers on a server-retained thread, which would require either
fighting that model to stay stateless or giving OpenAI an asymmetric
conversation-state mechanism Anthropic's own adapter has no equivalent
for.

## Single-call enforcement

Both adapters constrain every request to at most one tool call per
response, using each vendor's own documented mechanism:

- Anthropic: `tool_choice: { type: "auto", disable_parallel_tool_use: true }`
- OpenAI: `parallel_tool_calls: false`

If a vendor nevertheless returns more than one tool call in one response
despite this, the adapter reports it as a `protocol_violation` — the
harness **never** silently executes the first call and discards the
rest.

## Retry fairness

Both adapters set `maxRetries: 0` on their SDK client — zero automatic
retries. A prompt is scored on exactly one primary attempt per
repetition; a genuine transport-level failure invalidates that
case/repetition pair for **both** providers (never retried for only the
one that failed), and the operator reruns the pair explicitly. This
keeps neither vendor getting an extra reasoning attempt the other didn't
get.

## Sampling

Temperature/top_p/top_k are **intentionally omitted** for both vendors —
Anthropic's own docs note that setting a non-default value on
Claude 4.7-and-later models returns a 400 error, and forcing an
asymmetric setting on only one vendor would itself be an unfairness.
Every report records `sampling: "vendor-default"` as an explicit,
disclosed limitation.

## Three repetitions

The **official** comparison is 3 repetitions per case per provider
(36 × 2 × 3 = 216 primary runs) — `npm run run` / `tsx index.ts --run`
with no `--repetitions` override. Passing `--repetitions=N` with any
other value is supported for local debugging only, and the generated
report is explicitly marked **`NON_OFFICIAL_RUN`** — never presented as
the real comparison.

## Report artifacts

`npm run run` writes `results/results.json`, `results/results.csv`, and
`results/report.md` — all gitignored (`.gitignore`'s own `/results/`
entry; the committed `fixtures/` and `cases.ts` are unaffected). No API
key, raw SDK request/response header, or real customer content is ever
written there. Reproducibility metadata (git SHA, case/snapshot/system-prompt
hashes, both model IDs, the pricing snapshot date and prices actually
used, repetition count, ceilings, SDK versions) is recorded in every
run's own JSON output — see `report.ts`'s own `buildReproducibilityMetadata()`.

Drafting cases are additionally scored by a **blind** human packet
(vendor labels stripped, A/B order randomized with a recorded seed) —
objective tool/policy/factuality metrics stay fully machine-scored.

## Directory layout

```
scripts/ai-provider-eval/
  package.json / package-lock.json / tsconfig.json   — isolated deps & config
  tsconfig.extract.json    — root-context config for extract-fixtures.ts only
  .gitignore               — node_modules/, .env*, /results/
  extract-fixtures.ts      — the ONE file allowed to import the real registry
  fixtures/
    organization.ts        — the one synthetic organization
    tool-contracts.snapshot.json — extracted tool name/description/inputSchema
  tool-runtime.ts           — fixture-backed executors for the exact six tools
  cases.ts                  — 36 golden cases, 12 categories × 3
  result-types.ts           — benchmark-local result/trace types
  loop.ts                   — benchmark-only minimal orchestration loop
  scoring.ts                 — deterministic per-run metrics
  decision.ts                — quality gate + lexicographic + tie rule (frozen)
  pricing.ts                  — static pricing snapshot (reverify before each run)
  secrets.ts / network-allowlist.ts — secret + host safety
  providers/
    anthropic.ts / openai.ts  — benchmark-only vendor adapters (never live by default)
    stub.ts                    — offline stub used by --dry-run/--validate
  report.ts / index.ts         — report generation / CLI entry point
  test/                          — Node built-in test runner suite
```

## Cleanup / lifecycle

This package is intended to be **retained**, not deleted after the first
selection — it's small, fully isolated, and directly reusable the next
time a model upgrade needs the same 36-case comparison.
