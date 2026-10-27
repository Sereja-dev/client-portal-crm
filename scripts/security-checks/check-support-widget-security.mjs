import { readFileSync } from "node:fs";
import { report } from "./lib.mjs";

// Pre-Auth Support Widget V1, Slice B. This endpoint sends a real email
// on behalf of an unauthenticated visitor — the one thing it must never
// become is an arbitrary email relay. Deliberately narrow (each check a
// simple textual assertion against one specific file), matching
// check-leads-security.mjs's own "check for the absence of a risky
// pattern" style, not a general-purpose analyzer.

let ok = true;

const ACTIONS_FILE = "src/lib/support-widget/actions.ts";
const SUBMIT_FILE = "src/lib/support-widget/submit.ts";
const CONFIG_FILE = "src/lib/support-widget/config.ts";
const actionsContent = readFileSync(ACTIONS_FILE, "utf8");
const submitContent = readFileSync(SUBMIT_FILE, "utf8");
const configContent = readFileSync(CONFIG_FILE, "utf8");

// 1. The Server Action reads exactly these four FormData keys — never a
// fifth. A new field slipping in here (e.g. "to", "from", "subject")
// would mean client-controlled email metadata reaching submitSupportMessage.
const formDataGets = [...actionsContent.matchAll(/formData\.get\((["'])([^"']+)\1\)/g)].map((m) => m[2]);
const expectedFormDataKeys = ["email", "issueType", "message", "honeypot"];
const unexpectedFormDataKeys = formDataGets.filter((k) => !expectedFormDataKeys.includes(k));
const missingFormDataKeys = expectedFormDataKeys.filter((k) => !formDataGets.includes(k));
ok = report(
  "the Server Action reads exactly {email, issueType, message, honeypot} from FormData — no more, no fewer",
  unexpectedFormDataKeys.length === 0 && missingFormDataKeys.length === 0,
  [...unexpectedFormDataKeys.map((k) => `unexpected: ${k}`), ...missingFormDataKeys.map((k) => `missing: ${k}`)].join("\n"),
) && ok;

// 2. No tenant/account context of any kind reaches this public,
// unauthenticated flow — organizationId/userId have no legitimate
// reason to appear anywhere in submit.ts at all.
ok = report(
  "submit.ts never references organizationId or userId — no tenant/account context reaches this public flow",
  !submitContent.includes("organizationId") && !submitContent.includes("userId"),
  "",
) && ok;

// 3. The recipient (`to`) passed to sendEmail is always resolveSupportRecipient()'s
// own return value — never req uest input, and never INVITATION_FROM_EMAIL
// (the FROM-side env var) reused as a recipient.
const toIsResolvedRecipient = /to:\s*supportRecipient\b/.test(submitContent);
ok = report("sendEmail's `to` is always the resolved support recipient, never request input", toIsResolvedRecipient, "") && ok;

// 4. config.ts's recipient resolver never reads INVITATION_FROM_EMAIL —
// the one fallback this feature's own brief explicitly forbids. Checked
// against comment-stripped code: the module's own doc comment
// legitimately names that env var, explaining why resolveSupportRecipient()
// deliberately does not fall back to it — this check is about the real
// code, not that explanation.
const configCode = configContent.replace(/\/\*[\s\S]*?\*\//g, "");
ok = report(
  "config.ts's support-recipient resolver never references INVITATION_FROM_EMAIL in its actual code",
  !configCode.includes("INVITATION_FROM_EMAIL"),
  "",
) && ok;

// 5. No account-existence lookup anywhere in this feature — this public
// flow must never query whether the visitor's email matches a real User
// or PortalUser.
const supportWidgetFiles = [ACTIONS_FILE, SUBMIT_FILE, CONFIG_FILE, "src/lib/support-widget/validation.ts", "src/lib/support-widget/email-content.ts"];
let anyPrismaUserLookup = false;
let prismaLookupDetail = "";
for (const file of supportWidgetFiles) {
  const content = readFileSync(file, "utf8");
  if (/prisma\.(user|portalUser)\b/i.test(content)) {
    anyPrismaUserLookup = true;
    prismaLookupDetail += `${file} references prisma.user/portalUser\n`;
  }
}
ok = report("no file in src/lib/support-widget/ queries prisma.user or prisma.portalUser", !anyPrismaUserLookup, prismaLookupDetail) && ok;

// 6. No attachments field anywhere in this feature — V1 explicitly has no
// attachment support.
ok = report(
  "submit.ts never passes attachments to sendEmail",
  !submitContent.includes("attachments"),
  "",
) && ok;

process.exit(ok ? 0 : 1);
