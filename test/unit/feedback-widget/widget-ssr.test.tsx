import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/feedback-widget/actions", () => ({
  submitStaffSupportAction: vi.fn(),
  submitBugReportAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import { FeedbackWidget } from "@/components/feedback-widget/feedback-widget";

const props = { accountEmail: "jane@acme.example", workspaceName: "Acme" };

describe("FeedbackWidget server render", () => {
  it("renders nothing when neither tab is available", () => {
    expect(renderToStaticMarkup(<FeedbackWidget {...props} supportAvailable={false} bugReportAvailable={false} />)).toBe("");
  });

  it("renders one accessible, collapsed button and no panel or form until opened", () => {
    const html = renderToStaticMarkup(<FeedbackWidget {...props} supportAvailable bugReportAvailable />);
    expect(html).toContain('aria-label="Feedback: contact support or report a bug"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("jane@acme.example");
  });

  it("is a fixed 48px control that is hidden from print and does not rely on motion", () => {
    const html = renderToStaticMarkup(<FeedbackWidget {...props} supportAvailable bugReportAvailable />);
    expect(html).toMatch(/fixed/);
    expect(html).toContain("h-12");
    expect(html).toContain("w-12");
    expect(html).toContain("print:hidden");
    expect(html).not.toMatch(/\banimate-/);
  });

  it("contains no credentials or provider details in its markup", () => {
    const html = renderToStaticMarkup(<FeedbackWidget {...props} supportAvailable bugReportAvailable />);
    expect(html).not.toMatch(/re_[A-Za-z0-9]{8,}|api[_-]?key|bugs@|support@/i);
  });
});
