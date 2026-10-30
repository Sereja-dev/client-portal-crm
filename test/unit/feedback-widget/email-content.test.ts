import { describe, expect, it } from "vitest";
import { buildBugReportEmailContent, buildStaffSupportEmailContent } from "@/lib/feedback-widget/email-content";

const SENDER = { name: "Jane Owner", email: "jane@acme.example", role: "OWNER" };
const WORKSPACE = { id: "org-123", name: "Acme Studio", slug: "acme-studio" };
const DIAGNOSTICS = { route: "/clients/c1", submittedAt: "2026-11-02T10:00:00.000Z", userAgent: "UA/1.0", viewport: "1280 × 720" };

describe("buildStaffSupportEmailContent", () => {
  const content = buildStaffSupportEmailContent({ subject: "Invoice question", message: "Line one\nLine two", sender: SENDER, workspace: WORKSPACE });

  it("labels the subject so support can triage and sets no header-breaking characters", () => {
    expect(content.subject).toBe("[Aqenra Support · Staff] Invoice question");
    expect(content.subject).not.toMatch(/[\r\n]/);
  });

  it("includes the server-resolved account and workspace in both bodies", () => {
    for (const body of [content.html, content.text]) {
      expect(body).toContain("jane@acme.example");
      expect(body).toContain("Acme Studio");
      expect(body).toContain("org-123");
      expect(body).toContain("OWNER");
    }
  });

  it("preserves the message's line breaks and ends with the legal footer", () => {
    expect(content.html).toContain("Line one<br />Line two");
    expect(content.text).toContain("Line one\nLine two");
    expect(content.text).toContain("Privacy Policy:");
  });

  it("HTML-escapes every user-controlled value", () => {
    const hostile = buildStaffSupportEmailContent({
      subject: '<img src=x onerror="alert(1)">',
      message: "<script>alert(1)</script> & more",
      sender: { name: "<b>Mallory</b>", email: "m@x.example", role: "MEMBER" },
      workspace: { id: "o", name: "<i>Evil</i> Co", slug: "evil" },
    });
    expect(hostile.html).not.toMatch(/<script>|<img |<b>Mallory|<i>Evil/);
    expect(hostile.html).toContain("&lt;script&gt;");
    expect(hostile.html).toContain("&amp; more");
  });
});

describe("buildBugReportEmailContent", () => {
  const content = buildBugReportEmailContent({
    title: "Save button does nothing",
    description: "It does not save.",
    steps: "1. Open\n2. Click Save",
    expected: "It saves",
    actual: "Nothing",
    diagnostics: DIAGNOSTICS,
    sender: SENDER,
    workspace: WORKSPACE,
  });

  it("labels the subject as a bug", () => {
    expect(content.subject).toBe("[Aqenra Bug] Save button does nothing");
  });

  it("carries exactly the documented diagnostic context and labels it as the only automatic context", () => {
    for (const body of [content.html, content.text]) {
      expect(body).toContain("/clients/c1");
      expect(body).toContain("2026-11-02T10:00:00.000Z");
      expect(body).toContain("UA/1.0");
      expect(body).toContain("1280 × 720");
      expect(body).toMatch(/only automatic context attached/);
    }
  });

  it("includes the user's description, steps and optional expected/actual", () => {
    expect(content.text).toContain("What went wrong:\nIt does not save.");
    expect(content.text).toContain("Steps to reproduce:\n1. Open\n2. Click Save");
    expect(content.text).toContain("Expected behavior:\nIt saves");
    expect(content.text).toContain("Actual behavior:\nNothing");
  });

  it("omits the optional sections entirely when they are empty", () => {
    const minimal = buildBugReportEmailContent({ title: "T title", description: "D description", steps: "S steps here", expected: "", actual: "", diagnostics: DIAGNOSTICS, sender: SENDER, workspace: WORKSPACE });
    expect(minimal.text).not.toMatch(/Expected behavior|Actual behavior/);
    expect(minimal.html).not.toMatch(/Expected behavior|Actual behavior/);
  });

  it("contains no secret-bearing placeholders — nothing like cookies, tokens or passwords is ever rendered", () => {
    expect(content.html + content.text).not.toMatch(/cookie|token|password|authorization|session/i);
  });

  it("HTML-escapes every user-controlled value, including diagnostics", () => {
    const hostile = buildBugReportEmailContent({
      title: "<script>x</script>",
      description: "<img src=x onerror=1>",
      steps: "<a href='javascript:1'>go</a>",
      expected: "<b>e</b>",
      actual: "<i>a</i>",
      diagnostics: { ...DIAGNOSTICS, userAgent: "<script>ua</script>", route: "/<x>" },
      sender: SENDER,
      workspace: WORKSPACE,
    });
    expect(hostile.html).not.toMatch(/<script>|<img |<a href='javascript|<b>e|<i>a/);
    expect(hostile.html).toContain("&lt;a href=&#39;javascript:1&#39;&gt;");
  });
});
