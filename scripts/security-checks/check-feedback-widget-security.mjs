import { readFileSync, readdirSync } from "node:fs";
import { report, grep } from "./lib.mjs";

// Authenticated Staff Feedback Widget (support + bug reports). Both Server
// Actions send a real email on behalf of a signed-in Staff member, so the
// things they must never become are (a) an arbitrary email relay, (b) a way to
// name another user/organization, or (c) a bug-report path that quietly falls
// back to an unrelated mailbox. Narrow textual assertions, matching
// check-support-widget-security.mjs's style.

let ok = true;

const read = (f) => readFileSync(f, "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ACTIONS = "src/lib/feedback-widget/actions.ts";
const SUBMIT = "src/lib/feedback-widget/submit.ts";
const CONFIG = "src/lib/feedback-widget/config.ts";
const actions = stripComments(read(ACTIONS));
const submit = stripComments(read(SUBMIT));
const config = stripComments(read(CONFIG));

// Split the actions file into its two exported actions.
const bugStart = actions.indexOf("export async function submitBugReportAction");
const supportPart = actions.slice(actions.indexOf("export async function submitStaffSupportAction"), bugStart);
const bugPart = actions.slice(bugStart);

const keys = (src) => [...src.matchAll(/formData\.get\((["'])([^"']+)\1\)/g)].map((m) => m[2]).sort();
const sameKeys = (actual, expected) => JSON.stringify(actual) === JSON.stringify([...expected].sort());

// 1. Exact FormData keys — no identity, recipient or sender field can ride in.
ok = report(
  "the support action reads exactly {subject, message, submissionId, honeypot} from FormData",
  sameKeys(keys(supportPart), ["subject", "message", "submissionId", "honeypot"]),
  keys(supportPart).join(", "),
) && ok;
ok = report(
  "the bug-report action reads exactly the documented fields from FormData — no identity, recipient or sender field",
  sameKeys(keys(bugPart), ["title", "description", "steps", "expected", "actual", "route", "viewportWidth", "viewportHeight", "submissionId", "honeypot"]),
  keys(bugPart).join(", "),
) && ok;

// 2. Identity comes from the session, resolved server-side.
ok = report(
  "identity is resolved by getCurrentMembership() and never from FormData",
  actions.includes("getCurrentMembership()") && !/formData\.get\((["'])(userId|organizationId|email|to|from|replyTo)\1\)/.test(actions),
  "",
) && ok;

// 3. Each action rate-limits before it submits.
const limitedBefore = (part) => part.indexOf("limited(") !== -1 && part.indexOf("limited(") < part.search(/await submit(StaffSupport|BugReport)\(/);
ok = report("both actions rate-limit (per user and per organization) before sending", limitedBefore(supportPart) && limitedBefore(bugPart), "") && ok;

// 4. Fixed, independent routing: support -> support recipient, bug -> bug-report recipient.
const supportFn = submit.slice(submit.indexOf("export async function submitStaffSupport("), submit.indexOf("export async function submitBugReport("));
const bugFn = submit.slice(submit.indexOf("export async function submitBugReport("));
ok = report(
  "the support path sends only to resolveSupportRecipient() and never references the bug-report recipient",
  /to:\s*recipient\b/.test(supportFn) && supportFn.includes("resolveSupportRecipient()") && !supportFn.includes("resolveFeedbackRecipient"),
  "",
) && ok;
ok = report(
  "the bug path sends only to resolveFeedbackRecipient() and never references the support recipient (no fallback)",
  /to:\s*recipient\b/.test(bugFn) && bugFn.includes("resolveFeedbackRecipient()") && !bugFn.includes("resolveSupportRecipient"),
  "",
) && ok;
ok = report(
  "a missing destination returns NOT_CONFIGURED in both paths — never another address",
  (supportFn.match(/reason: "NOT_CONFIGURED"/g) ?? []).length === 1 && (bugFn.match(/reason: "NOT_CONFIGURED"/g) ?? []).length === 1,
  "",
) && ok;

// 5. The bug-report recipient resolver has no fallback to any other address.
ok = report(
  "config.ts's bug-report resolver reads only PLATFORM_FEEDBACK_EMAIL (no INVITATION_FROM_EMAIL / PLATFORM_SUPPORT_EMAIL / REPLY_TO fallback)",
  config.includes("PLATFORM_FEEDBACK_EMAIL") && !/INVITATION_FROM_EMAIL|PLATFORM_SUPPORT_EMAIL|PLATFORM_REPLY_TO_EMAIL/.test(config),
  "",
) && ok;

// 6. Reply-To is the server-resolved account email; no attachments.
ok = report("replyTo is the server-resolved account email in both paths", (submit.match(/replyTo:\s*identity\.sender\.email/g) ?? []).length === 2, "") && ok;
ok = report("no attachments are ever passed to sendEmail", !submit.includes("attachments"), "") && ok;

// 7. Client code never touches the environment, cookies or storage.
const clientFiles = ["src/components/feedback-widget/feedback-widget.tsx", "src/components/feedback-widget/feedback-forms.tsx"];
const clientProblems = clientFiles.flatMap((f) => {
  const code = stripComments(read(f));
  return /process\.env|document\.cookie|localStorage|sessionStorage|indexedDB/.test(code) ? [f] : [];
});
ok = report("the widget's client components never read process.env, cookies or browser storage", clientProblems.length === 0, clientProblems.join("\n")) && ok;

// 7b. Browser storage is confined to position-storage.ts and holds ONLY the button's coordinates.
const widgetDir = "src/components/feedback-widget";
const storageUsers = readdirSync(widgetDir)
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .filter((f) => /localStorage|sessionStorage|indexedDB/.test(stripComments(read(`${widgetDir}/${f}`))));
ok = report("only position-storage.ts touches browser storage in the widget", storageUsers.length === 1 && storageUsers[0] === "position-storage.ts", storageUsers.join("\n")) && ok;
const storageCode = stripComments(read("src/components/feedback-widget/position-storage.ts"));
ok = report(
  "position-storage.ts persists one key with only version/right/bottom — no form, account or workspace data",
  (storageCode.match(/setItem\(/g) ?? []).length === 1 &&
    /JSON\.stringify\(\{ version: VERSION, right: [^}]*bottom: [^}]*\}\)/.test(storageCode) &&
    !/subject|message|title|description|steps|email|workspace|userId|organization/i.test(storageCode),
  "",
) && ok;
const formsAndWidget = clientFiles.map((f) => read(f)).join("\n");
ok = report("the form components never import the position storage", !/position-storage/.test(read("src/components/feedback-widget/feedback-forms.tsx")) && /position-storage/.test(formsAndWidget), "") && ok;

// 8. The widget is mounted only in the authenticated Staff layout.
const mounts = grep("<FeedbackWidget", "src")
  .split("\n")
  .filter((line) => line && !line.includes("src/components/feedback-widget/"));
ok = report(
  "<FeedbackWidget> is mounted only in the (dashboard) Staff layout",
  mounts.length === 1 && mounts[0].includes("src/app/(dashboard)/layout.tsx"),
  mounts.join("\n"),
) && ok;

process.exit(ok ? 0 : 1);
