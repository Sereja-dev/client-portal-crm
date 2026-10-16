import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Empty States Improvement, Slice A — the shared primitive's own first
 * dedicated test (previously covered only indirectly via each domain
 * page's own E2E suite). Proves the new, optional `secondaryAction` prop
 * is purely additive: every pre-existing call site passes only `action`
 * (or neither), and that exact shape must keep rendering through the
 * same untouched branch as before this prop existed.
 */
describe("EmptyState", () => {
  it("renders title and description only when neither action is given", () => {
    const html = renderToStaticMarkup(<EmptyState title="No records yet" description="They will appear here." />);
    expect(html).toContain("No records yet");
    expect(html).toContain("They will appear here.");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<button");
  });

  it("action only: renders through the plain, pre-existing single-action markup", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="No records yet"
        description="They will appear here."
        action={<a href="/new">Create</a>}
      />,
    );
    expect(html).toContain("Create");
    // The pre-existing action-only wrapper carries no flex/gap classes —
    // confirms this call shape is untouched by the new two-action branch.
    expect(html).toMatch(/<div class="mt-4"><a href="\/new">Create<\/a><\/div>/);
  });

  it("action + secondaryAction: both render, primary before secondary in DOM order", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="No records yet"
        description="They will appear here."
        action={<a href="/new">Create</a>}
        secondaryAction={<a href="/templates">Browse templates</a>}
      />,
    );
    expect(html).toContain("Create");
    expect(html).toContain("Browse templates");
    expect(html.indexOf("Create")).toBeLessThan(html.indexOf("Browse templates"));
  });

  it("secondaryAction without action: still renders the secondary action alone", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="No records yet"
        description="They will appear here."
        secondaryAction={<a href="/templates">Browse templates</a>}
      />,
    );
    expect(html).toContain("Browse templates");
  });

  it("decorative icon stays aria-hidden regardless of action combination", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="No records yet"
        description="They will appear here."
        action={<a href="/new">Create</a>}
        secondaryAction={<a href="/templates">Browse templates</a>}
      />,
    );
    expect(html).toContain('aria-hidden="true"');
  });
});
