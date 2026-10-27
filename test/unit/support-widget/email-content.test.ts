import { describe, expect, it } from "vitest";
import { buildSupportMessageEmailContent } from "@/lib/support-widget/email-content";

describe("buildSupportMessageEmailContent", () => {
  it("builds the expected subject for each category, from fixed labels only", () => {
    expect(buildSupportMessageEmailContent({ issueType: "cant-sign-up", visitorEmail: "v@example.com", message: "x".repeat(20) }).subject).toBe(
      "[Aqenra Support] Can't sign up",
    );
    expect(buildSupportMessageEmailContent({ issueType: "cant-sign-in", visitorEmail: "v@example.com", message: "x".repeat(20) }).subject).toBe(
      "[Aqenra Support] Can't sign in",
    );
    expect(buildSupportMessageEmailContent({ issueType: "other", visitorEmail: "v@example.com", message: "x".repeat(20) }).subject).toBe(
      "[Aqenra Support] Other issue",
    );
  });

  it("never includes the visitor's message in the subject", () => {
    const content = buildSupportMessageEmailContent({
      issueType: "other",
      visitorEmail: "v@example.com",
      message: "SECRET_MARKER_TEXT this is my actual problem description",
    });
    expect(content.subject).not.toContain("SECRET_MARKER_TEXT");
    expect(content.subject).not.toContain("this is my actual problem");
  });

  it("never includes the visitor's email in the subject", () => {
    const content = buildSupportMessageEmailContent({
      issueType: "other",
      visitorEmail: "distinctive-visitor-address@example.com",
      message: "x".repeat(20),
    });
    expect(content.subject).not.toContain("distinctive-visitor-address");
  });

  it("includes the category, visitor email, and message in both html and text bodies", () => {
    const content = buildSupportMessageEmailContent({
      issueType: "cant-sign-in",
      visitorEmail: "visitor@example.com",
      message: "I cannot sign in no matter what I try.",
    });
    expect(content.html).toContain("Can&#39;t sign in");
    expect(content.html).toContain("visitor@example.com");
    expect(content.html).toContain("I cannot sign in no matter what I try.");
    expect(content.text).toContain("Can't sign in");
    expect(content.text).toContain("visitor@example.com");
    expect(content.text).toContain("I cannot sign in no matter what I try.");
  });

  it("escapes HTML-significant characters in the visitor email within the html body", () => {
    // Not a realistic valid email (validation.ts would reject it before
    // this function is ever called), but proves the escaping itself
    // works correctly in isolation, independent of upstream validation.
    const content = buildSupportMessageEmailContent({
      issueType: "other",
      visitorEmail: '"><script>alert(1)</script>@example.com',
      message: "x".repeat(20),
    });
    expect(content.html).not.toContain("<script>alert(1)</script>");
    expect(content.html).toContain("&lt;script&gt;");
  });

  it("escapes HTML-significant characters in the message within the html body", () => {
    const content = buildSupportMessageEmailContent({
      issueType: "other",
      visitorEmail: "visitor@example.com",
      message: `<img src=x onerror=alert(1)> ${"a".repeat(20)}`,
    });
    expect(content.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(content.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("preserves line breaks in the message as <br /> in html, and as real newlines in text", () => {
    const message = `Line one.\nLine two.\n${"x".repeat(10)}`;
    const content = buildSupportMessageEmailContent({ issueType: "other", visitorEmail: "visitor@example.com", message });
    expect(content.html).toContain("Line one.<br />Line two.");
    expect(content.text).toContain("Line one.\nLine two.");
  });

  it("includes a reminder that replying reaches the visitor", () => {
    const content = buildSupportMessageEmailContent({ issueType: "other", visitorEmail: "visitor@example.com", message: "x".repeat(20) });
    expect(content.html.toLowerCase()).toContain("reply");
    expect(content.text.toLowerCase()).toContain("reply");
  });

  it("includes the shared legal footer in both bodies", () => {
    const content = buildSupportMessageEmailContent({ issueType: "other", visitorEmail: "visitor@example.com", message: "x".repeat(20) });
    expect(content.html).toContain("Privacy Policy");
    expect(content.text).toContain("Privacy Policy");
  });

  it("never includes a password, token, or cookie-shaped string — this content builder has no such input to leak in the first place", () => {
    const content = buildSupportMessageEmailContent({ issueType: "other", visitorEmail: "visitor@example.com", message: "x".repeat(20) });
    expect(content.html.toLowerCase()).not.toContain("password");
    expect(content.html.toLowerCase()).not.toContain("session");
    expect(content.text.toLowerCase()).not.toContain("password");
  });
});
