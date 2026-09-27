import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Production hydration defect follow-up: the "Connected {date}" text used
// toLocaleDateString() with no locale argument, resolving to Node's default
// locale during SSR but the browser's navigator.language during hydration —
// the same implicit-locale mechanism as relativeTime()'s proven defect. See
// relative-time-locale.test.ts for the full context.

const source = readFileSync(
  "src/app/(dashboard)/settings/integrations/slack-connection-card.tsx",
  "utf-8",
);

describe("SlackConnectionCard — connected-date text is locale-stable", () => {
  it("calls toLocaleDateString with an explicit 'en-US' locale, never the environment-implicit default", () => {
    expect(source).toMatch(/\.toLocaleDateString\("en-US"\)/);
    expect(source).not.toMatch(/\.toLocaleDateString\(\)/);
  });
});
