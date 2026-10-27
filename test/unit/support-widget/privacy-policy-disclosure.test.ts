import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Pre-Auth Support Widget V1, Slice B. The Privacy Policy's own
 * disclosure addition covering the new, genuinely new personal-data
 * category this feature introduces: a visitor's contact email, issue
 * category, and free-text message, collected before they have an
 * account. No DOM/component-rendering harness exists in this repo (see
 * legal-back-button-contract.test.ts's own header comment) — this is
 * therefore a source-contract proxy over the real file, same convention
 * every other legal-page test in this repo already uses.
 */

const privacySource = readFileSync("src/app/privacy/page.tsx", "utf8");

describe("Privacy Policy — support-message disclosure (Section 2)", () => {
  it("discloses the new category: contact email, issue category, and message", () => {
    expect(privacySource).toMatch(/Support messages/);
    expect(privacySource).toMatch(/email address, issue category, and message/);
  });

  it("states this applies before the visitor has an account", () => {
    expect(privacySource).toMatch(/before\s*\n?\s*creating an account/);
  });

  it("states the information is used only to respond to the request", () => {
    expect(privacySource).toMatch(/use it only to\s*\n?\s*respond to your request/);
  });

  it("references the existing email provider via Section 4, without duplicating or re-naming it", () => {
    expect(privacySource).toMatch(/same email provider named in Section 4/);
    // Section 4 already names Resend as the transactional-email
    // sub-processor — this disclosure deliberately doesn't repeat "Resend"
    // a second time, so the two sections can never silently drift apart.
    expect(privacySource).not.toMatch(/Support messages[\s\S]{0,400}Resend/);
  });

  it("does not invent a precise retention period for support messages", () => {
    // "Section 6. Data retention" already exists for other categories and
    // deliberately does not mention support messages — this slice adds no
    // retention claim for them at all, rather than inventing one.
    const retentionSection = privacySource.match(/6\. Data retention[\s\S]*?(?=<\/section>)/)?.[0] ?? "";
    expect(retentionSection).not.toMatch(/support message/i);
  });

  it("does not claim a specific legal basis or universal compliance for this category", () => {
    const supportBullet = privacySource.match(/Support messages\.[\s\S]{0,400}/)?.[0] ?? "";
    expect(supportBullet).not.toMatch(/legal basis|legitimate interest|consent\b|GDPR|CCPA/i);
  });
});

describe("Privacy Policy — Section 3 use-of-information addition", () => {
  it("adds a bullet for responding to support requests, including before account creation", () => {
    expect(privacySource).toMatch(/Respond to support requests you send us, including before you have an account/);
  });

  it("the existing Section 3 bullets remain present and unmodified", () => {
    expect(privacySource).toMatch(/Provide, operate, and maintain the Service, including authenticating you/);
    expect(privacySource).toMatch(/Send transactional email you&rsquo;ve triggered/);
    expect(privacySource).toMatch(/Detect, prevent, and respond to abuse, fraud, and security incidents/);
    expect(privacySource).toMatch(/Comply with legal obligations/);
  });
});

describe("Privacy Policy — Cookie Policy untouched", () => {
  it("this slice does not modify the Cookie Policy page — the support widget introduces no new cookie or storage", () => {
    const cookiesSource = readFileSync("src/app/cookies/page.tsx", "utf8");
    expect(cookiesSource).not.toMatch(/support widget|support message/i);
  });
});
