import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Production hydration defect follow-up: these three "use client" components
// each set a `title` attribute via `<date>.toLocaleString()` with no locale
// argument — the identical implicit-locale mechanism as relativeTime()'s
// proven defect, live-verified on Production for notification-list-item.tsx
// (server title="9/8/2026, 2:50:16 PM" vs. hydrated ru-RU
// title="08.09.2026, 21:50:16"). Source-contract style, matching this
// repo's existing convention (see invoice-send-controls-contract.test.ts).

const components = [
  {
    name: "notification-list-item.tsx",
    path: "src/components/notifications/notification-list-item.tsx",
  },
  {
    name: "comment-item.tsx",
    path: "src/components/comments/comment-item.tsx",
  },
  {
    name: "timeline-note-item.tsx",
    path: "src/components/timeline/timeline-note-item.tsx",
  },
];

describe.each(components)("$name — title attribute uses an explicit, locale-stable format", ({ path }) => {
  const source = readFileSync(path, "utf-8");

  it("calls toLocaleString with an explicit 'en-US' locale, never the environment-implicit default", () => {
    expect(source).toMatch(/title=\{[^}]*\.toLocaleString\("en-US"\)\}/);
  });

  it("never calls toLocaleString() with no locale argument", () => {
    expect(source).not.toMatch(/title=\{[^}]*\.toLocaleString\(\)\}/);
  });
});
