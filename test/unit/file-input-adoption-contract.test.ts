import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Product UI/UX PR 1 — proves the two real production file-input call
 * sites actually adopted the new shared <FileInput> component, preserving
 * every existing contract (FormData field name, accept filter, required/
 * disabled/pending behavior, error/help text, upload action) unchanged.
 *
 * Source-contract only, same repo-wide precedent as
 * file-input-contract.test.ts's own header comment explains — never
 * imports/renders either caller component.
 *
 * Before this PR, both files render a raw <input type="file"> styled only
 * via Tailwind's file: pseudo-class variant, so every "uses <FileInput>"
 * assertion below fails against the current, unmodified source — the
 * intended RED reason: the UI relies on native browser-authored
 * file-picker text rather than an app-authored label, exactly as recorded
 * by the Product UI/UX audit.
 */

const ATTACHMENT_FORM_PATH = "src/components/attachments/attachment-upload-form.tsx";
const LOGO_FORM_PATH = "src/app/(dashboard)/settings/company/logo-upload-form.tsx";

// Comments stripped once per file — both callers' own pre-existing doc
// comments legitimately discuss (in prose) the literal text
// `<input type="file">`, which would otherwise false-positive the "no raw
// native file input remains" checks below against prose rather than real
// JSX. Same discipline this repo's own seed-contract/migration-contract
// tests already established.
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("AttachmentUploadForm — adopts the shared FileInput component", () => {
  const source = readFileSync(ATTACHMENT_FORM_PATH, "utf-8");
  const sourceCodeOnly = codeOnly(source);

  it("imports FileInput from the shared ui module", () => {
    expect(source).toMatch(/import\s*\{\s*FileInput\s*\}\s*from\s*["']@\/components\/ui\/file-input["']/);
  });

  it("renders <FileInput ... /> instead of a raw <input type=\"file\">", () => {
    expect(source).toMatch(/<FileInput/);
    expect(sourceCodeOnly).not.toMatch(/<input[\s\S]*?type=["']file["']/);
  });

  it("passes the exact preserved FormData name (\"file\"), accept filter, required, and disabled contract unchanged", () => {
    const tagMatch = source.match(/<FileInput[\s\S]*?\/>/);
    expect(tagMatch).not.toBeNull();
    const tag = tagMatch![0];
    expect(tag).toMatch(/name=["']file["']/);
    expect(tag).toMatch(/accept=\{ACCEPTED_EXTENSIONS\}/);
    expect(tag).toMatch(/required/);
    expect(tag).toMatch(/disabled=\{disabled \|\| pending\}/);
  });

  it("passes the app-authored trigger label \"Choose file\"", () => {
    const tagMatch = source.match(/<FileInput[\s\S]*?\/>/)![0];
    expect(tagMatch).toMatch(/triggerLabel=["']Choose file["']/);
  });

  it("preserves the existing ACCEPTED_EXTENSIONS constant, the state.error alert, disabledReason help text, and the post-success form.reset() effect unchanged", () => {
    expect(source).toContain(
      'const ACCEPTED_EXTENSIONS =\n  ".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx";',
    );
    expect(source).toMatch(/role=["']alert["'][\s\S]*?\{state\.error\}/);
    expect(source).toMatch(/disabled && disabledReason && !state\.error/);
    expect(source).toMatch(/formRef\.current\?\.reset\(\)/);
  });

  it("still uses useActionState with the caller-supplied action prop — the upload action contract is unchanged", () => {
    expect(source).toMatch(/useActionState\(action, initialState\)/);
  });
});

describe("LogoUploadForm — adopts the shared FileInput component", () => {
  const source = readFileSync(LOGO_FORM_PATH, "utf-8");
  const sourceCodeOnly = codeOnly(source);

  it("imports FileInput from the shared ui module", () => {
    expect(source).toMatch(/import\s*\{\s*FileInput\s*\}\s*from\s*["']@\/components\/ui\/file-input["']/);
  });

  it("renders <FileInput ... /> instead of a raw <input type=\"file\">", () => {
    expect(source).toMatch(/<FileInput/);
    expect(sourceCodeOnly).not.toMatch(/<input[\s\S]*?type=["']file["']/);
  });

  it("passes the exact preserved FormData name (\"file\"), accept filter, required, disabled, and onChange (preview) contract unchanged", () => {
    const tagMatch = source.match(/<FileInput[\s\S]*?\/>/);
    expect(tagMatch).not.toBeNull();
    const tag = tagMatch![0];
    expect(tag).toMatch(/name=["']file["']/);
    expect(tag).toMatch(/accept=\{ACCEPTED_TYPES\}/);
    expect(tag).toMatch(/required/);
    expect(tag).toMatch(/disabled=\{pending\}/);
    expect(tag).toMatch(/onChange=\{handleFileChange\}/);
  });

  it("passes the app-authored trigger label \"Choose logo\"", () => {
    const tagMatch = source.match(/<FileInput[\s\S]*?\/>/)![0];
    expect(tagMatch).toMatch(/triggerLabel=["']Choose logo["']/);
  });

  it("preserves the existing ACCEPTED_TYPES constant, live blob preview logic, state.error alert, and key-based remount-on-success behavior unchanged", () => {
    expect(source).toContain('const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp";');
    expect(source).toMatch(/URL\.createObjectURL\(file\)/);
    expect(source).toMatch(/role=["']alert["'][\s\S]*?\{state\.error\}/);
    expect(source).toMatch(/key=\{currentLogoUrl \?\? "none"\}/);
  });

  it("still uses useActionState with uploadCompanyLogoAction — the upload action contract is unchanged", () => {
    expect(source).toMatch(/useActionState\(uploadCompanyLogoAction, initialState\)/);
  });
});
