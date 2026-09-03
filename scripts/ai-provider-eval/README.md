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

## Official-run freshness gate

**`--run` refuses to make any provider call — before checking for API
keys, before any dynamic provider import, before any client
construction — unless the committed tool-contract snapshot is fresh.**
Freshness is checked by `snapshot-freshness.ts` and enforced by
`index.ts`'s own `enforceSnapshotFreshnessOrExit()`, which runs first in
`runLiveBenchmark()`. See `test/freshness-ordering.test.ts` for an
end-to-end proof (a real subprocess spawn against a deliberately
corrupted snapshot) that a stale snapshot is refused before the
key-presence check is ever reached, and `test/snapshot-freshness.test.ts`
for adversarial proof of the fingerprint's own sensitivity.

**Freshness is a SOURCE CONTENT fingerprint, not a git commit SHA.** An
earlier design compared the snapshot's own recorded git commit SHA
against the current `git rev-parse HEAD`. That has a real circularity
problem: committing the refreshed snapshot advances HEAD to a *new* SHA
that the file being committed can never have recorded in advance (a
commit cannot contain its own future hash) — so a commit-SHA gate fails
immediately after every legitimate refresh-and-commit cycle, not only
after real drift. `snapshot-freshness.ts` instead hashes the exact bytes
of the fixed, small set of source files that determine what gets
extracted (see `FRESHNESS_SOURCE_FILES` in that file — the registry, the
five tool-implementation files, and the four `*_STATUSES`/`*_PRIORITIES`
enum-source validation files). This fingerprint is content-addressed:
it's unaffected by which commit HEAD happens to be on, so it stays valid
across any number of unrelated commits — including the very commit that
checks the refreshed snapshot in — and changes the instant a tracked
file's bytes do. `extractedFromGitSha` is still recorded in the snapshot
as informational reproducibility metadata, but it is **never** the gate.

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
# A. from the repo root, obtain current HEAD (optional — only feeds the
#    informational extractedFromGitSha metadata field, not the gate):
git rev-parse HEAD

# B. run the extractor from the repo root — it computes and writes the
#    real sourceFingerprint automatically, every time, with no manual
#    SHA bookkeeping required:
AQENRA_EVAL_EXTRACT_GIT_SHA=$(git rev-parse HEAD) \
  npx tsx scripts/ai-provider-eval/extract-fixtures.ts

# C. verify the resulting diff — expect changes only if a tool's
#    schema/description, or one of the enum-source files, actually
#    changed:
git diff scripts/ai-provider-eval/fixtures/tool-contracts.snapshot.json

# D. validate freshness offline before trusting it:
cd scripts/ai-provider-eval && npm run validate

# then commit the refreshed snapshot if step C showed a real change (or
# only the informational extractedFromGitSha/generatedAt-style fields
# advancing is fine to commit too) — committing does NOT make the
# snapshot stale again, because sourceFingerprint depends only on the
# tracked source files' own bytes, never on git history or the snapshot
# file's own content.
```

Re-run this whenever a real tool's schema/description, or one of
`src/lib/validation/{client,project,task,invoice}.ts`'s own
`*_STATUSES`/`*_PRIORITIES` arrays, changes in the app. The script fails
loudly if the registered tool set ever stops being exactly the approved
six. Its own type-checking lives in a dedicated, root-context config
(also run from the repo root):

```bash
npx tsc -p scripts/ai-provider-eval/tsconfig.extract.json --noEmit
```

Only *after* the snapshot is refreshed and freshness passes locally
(`npm run validate`, or simply attempting `--run` and confirming it gets
past the freshness check) should you proceed to an actual live `--run`.

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

**Automatic staleness warning, not a refusal.** `pricing.ts`'s own
`getPricingFreshnessWarning()` compares `PRICING_SNAPSHOT_DATE` against
the current date; once it's more than `PRICING_FRESHNESS_WARNING_THRESHOLD_DAYS`
(30, documented in `pricing.ts`) old, every generated `report.md` shows a
prominent `STALE_PRICING_WARNING` banner near the top of the file, and
`results.json`'s own reproducibility metadata carries the same warning
string. This is deliberately a **warning only** — the official run still
refuses for exactly one reason (the tool-contract snapshot freshness gate
above); a stale price produces a misleading cost *estimate*, not an
unsafe run, so it doesn't get elevated to the same hard gate, and the
frozen four-value `SelectionOutcome` enum (`decision.ts`) is unaffected
by pricing staleness — there is no fifth `REQUIRES_PRICE_REVERIFY`
outcome.

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

`npm run run` writes `results/results.json`, `results/results.csv`,
`results/report.md`, `results/drafting-blind-packet.json`, and
`results/drafting-blind-mapping.json` — all gitignored (`.gitignore`'s
own `/results/` entry; the committed `fixtures/` and `cases.ts` are
unaffected). No API key, raw SDK request/response header, or real
customer content is ever written there. Reproducibility metadata (git
SHA, case/snapshot/system-prompt hashes, both model IDs, the pricing
snapshot date/prices/staleness warning actually used, repetition count,
ceilings, SDK versions) is recorded in every run's own JSON output — see
`report.ts`'s own `buildReproducibilityMetadata()`.

**CSV formula-injection safety.** `report.ts`'s own
`sanitizeCsvCellForSpreadsheet()` prefixes any CSV cell whose (trimmed)
content starts with `=`, `+`, `-`, or `@` with a leading apostrophe
before the normal comma/quote/newline escaping runs — the classic
spreadsheet formula-injection vector, applied to every cell (not just
`toolSequence`) so a model-influenced value (a hallucinated or
adversarially-provoked tool name) can never execute as a formula when
`results.csv` is opened in Excel/Sheets/Numbers. JSON and Markdown
output are untouched by this — only the CSV writer applies it. See
`test/csv-sanitization.test.ts`.

### Blind drafting packet

Generated automatically after **every** completed official run (not only
when the automated comparison actually lands on
`TIE_ADDITIONAL_EVIDENCE_REQUIRED`), so the artifact always exists —
`drafting-packet.ts`'s own `buildDraftingBlindArtifacts()` +
`writeDraftingBlindArtifacts()`, called from `index.ts` right after
`writeReport()`. It may simply go unused if the automated 5-dimension
comparison already decided the outcome.

- **`results/drafting-blind-packet.json`** — what the human scorer sees.
  Covers **all three repetitions** for each of the 3 drafting cases (not
  one cherry-picked sample), so a scorer sees the model's own run-to-run
  variance. Contains only `blindId`/`caseId`/`category`/`repetition`/
  `slot`/`prompt`/`finalText` — no provider, no model, no token/cost/
  latency, no `errorClass`. A/B slot assignment is randomized per
  (caseId, repetition) pair using a fixed, recorded seed
  (`DRAFTING_BLIND_SEED` in `drafting-packet.ts`) — the same run data and
  seed always reproduce the same packet byte-for-byte, and input order
  never affects the result.
- **`results/drafting-blind-mapping.json`** — the real `blindId` →
  provider/model reversal. Local-only, gitignored, never referenced from
  the scorer-visible packet. Keep it closed until scores are entered.

**Known, accepted limitation:** this redacts every *structured* identity
field. It cannot scrub semantic self-identification from a model's own
free-text answer (e.g. if a response happened to say "As Claude, I...")
— the drafting prompts in `cases.ts` give a model no reason to do this,
but this is a content-level limitation inherent to any blind comparison
of real model output, not something fixable mechanically.

Objective tool/policy/factuality metrics stay fully machine-scored
(`scoring.ts`); only drafting quality is ever human-scored, and only as
the lexicographic tie-break of last resort.

## Directory layout

```
scripts/ai-provider-eval/
  package.json / package-lock.json / tsconfig.json   — isolated deps & config
  tsconfig.extract.json    — root-context config for extract-fixtures.ts only
  .gitignore               — node_modules/, .env*, /results/
  extract-fixtures.ts      — the ONE file allowed to import the real registry
  snapshot-freshness.ts    — content-fingerprint freshness gate (no commit-SHA circularity)
  fixtures/
    organization.ts        — the one synthetic organization
    tool-contracts.snapshot.json — extracted tool name/description/inputSchema + sourceFingerprint
  tool-runtime.ts           — fixture-backed executors for the exact six tools
  cases.ts                  — 36 golden cases, 12 categories × 3
  result-types.ts           — benchmark-local result/trace types
  loop.ts                   — benchmark-only minimal orchestration loop
  scoring.ts                 — deterministic per-run metrics
  decision.ts                — quality gate + lexicographic + tie rule (frozen)
  pricing.ts                  — static pricing snapshot + staleness warning (reverify before each run)
  drafting-packet.ts          — blind human drafting-packet + mapping generation
  secrets.ts / network-allowlist.ts — secret + host safety
  providers/
    anthropic.ts / openai.ts  — benchmark-only vendor adapters (never live by default)
    stub.ts                    — offline stub used by --dry-run/--validate
  report.ts / index.ts         — report generation (incl. CSV formula-injection safety) / CLI entry point
  test/                          — Node built-in test runner suite
```

## Cleanup / lifecycle

This package is intended to be **retained**, not deleted after the first
selection — it's small, fully isolated, and directly reusable the next
time a model upgrade needs the same 36-case comparison.
