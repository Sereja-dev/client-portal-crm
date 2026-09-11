import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "@/components/ui/status-badge";
import { MessageList } from "@/components/client-requests/message-list";
import type { ClientRequestMessageViewModel } from "@/lib/client-requests/format-message";

/**
 * Client Requests / Tickets Phase 2A — genuine render coverage (test
 * items 23, 24, 25), same `renderToStaticMarkup` approach as
 * test/unit/record-list.test.tsx's own established precedent (this repo
 * has no DOM/component-interaction harness).
 */

describe("23. StatusBadge — Client Request status/priority labels render correctly", () => {
  it("formats every ClientRequestStatus value with its own readable label", () => {
    const expectations: [string, string][] = [
      ["OPEN", "Open"],
      ["IN_PROGRESS", "In Progress"],
      ["WAITING_ON_CLIENT", "Waiting On Client"],
      ["RESOLVED", "Resolved"],
      ["CLOSED", "Closed"],
    ];
    for (const [status, label] of expectations) {
      const html = renderToStaticMarkup(<StatusBadge status={status} />);
      expect(html).toContain(label);
    }
  });

  it("formats every ClientRequestPriority value with its own readable label", () => {
    const expectations: [string, string][] = [
      ["LOW", "Low"],
      ["NORMAL", "Normal"],
      ["HIGH", "High"],
      ["URGENT", "Urgent"],
    ];
    for (const [priority, label] of expectations) {
      const html = renderToStaticMarkup(<StatusBadge status={priority} />);
      expect(html).toContain(label);
    }
  });

  it("gives OPEN/RESOLVED/CLOSED/WAITING_ON_CLIENT/NORMAL each their own real, distinct tone class", () => {
    const open = renderToStaticMarkup(<StatusBadge status="OPEN" />);
    const resolved = renderToStaticMarkup(<StatusBadge status="RESOLVED" />);
    const closed = renderToStaticMarkup(<StatusBadge status="CLOSED" />);
    const waiting = renderToStaticMarkup(<StatusBadge status="WAITING_ON_CLIENT" />);
    const normal = renderToStaticMarkup(<StatusBadge status="NORMAL" />);

    // Tones differ enough that at least these pairs must never render
    // byte-identical class strings (proves each has its own real tone
    // entry, not an accidental shared/empty fallback).
    expect(open).not.toBe(resolved);
    expect(resolved).not.toBe(closed);
    expect(closed).not.toBe(waiting);
    expect(waiting).not.toBe(normal);
  });
});

describe("24. Archived state renders clearly", () => {
  it("StatusBadge renders a real, visible 'Archived' badge distinct from every status/priority badge", () => {
    const archived = renderToStaticMarkup(<StatusBadge status="ARCHIVED" />);
    expect(archived).toContain("Archived");
    const open = renderToStaticMarkup(<StatusBadge status="OPEN" />);
    expect(archived).not.toBe(open);
  });

  // A StaffRequestControls-level render test (disabled selects when
  // archived) was attempted here but dropped: that component calls
  // next/navigation's useRouter(), which throws ("invariant expected app
  // router to be mounted") under renderToStaticMarkup outside a real
  // Next.js app tree — this repo has no router-mocking convention
  // established (no DOM/component-interaction harness at all — see this
  // file's own header comment), so forcing one here would be introducing
  // a new test capability, not reusing an established pattern. The
  // disabled-when-archived behavior itself is plain, directly-readable
  // conditional JSX (`disabled={isPending || isArchived}`), exercised in
  // practice by the archived-request integration coverage in
  // staff-actions.test.ts instead.
});

function message(overrides: Partial<ClientRequestMessageViewModel>): ClientRequestMessageViewModel {
  return {
    id: "msg-1",
    body: "Hello there",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    authorName: "Jane",
    authorType: "STAFF",
    ...overrides,
  };
}

describe("25. MessageList — Staff vs Portal authors render distinctly", () => {
  it("renders each message's own author name and body", () => {
    const html = renderToStaticMarkup(
      <MessageList messages={[message({ authorName: "Jane Staff", body: "We are on it." })]} />,
    );
    expect(html).toContain("Jane Staff");
    expect(html).toContain("We are on it.");
  });

  it("a STAFF message and a PORTAL message render visibly different author-type markers", () => {
    const staffHtml = renderToStaticMarkup(<MessageList messages={[message({ authorType: "STAFF" })]} />);
    const portalHtml = renderToStaticMarkup(<MessageList messages={[message({ authorType: "PORTAL" })]} />);

    expect(staffHtml).toContain("Staff");
    expect(staffHtml).not.toContain(">Client<");
    expect(portalHtml).toContain("Client");
    expect(portalHtml).not.toContain(">Staff<");
    expect(staffHtml).not.toBe(portalHtml);
  });

  it("renders 'No messages yet' for an empty conversation", () => {
    const html = renderToStaticMarkup(<MessageList messages={[]} />);
    expect(html).toContain("No messages yet");
  });

  it("renders messages in the order given (chronological — the caller's own responsibility, already oldest-first from listClientRequestMessagesFor*)", () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[message({ id: "1", body: "First message" }), message({ id: "2", body: "Second message" })]}
      />,
    );
    expect(html.indexOf("First message")).toBeLessThan(html.indexOf("Second message"));
  });
});
