import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TimeEntryForm } from "@/components/time-entries/time-entry-form";
import { StatusBadge } from "@/components/ui/status-badge";
import type { TimeEntryFormState } from "@/types";

/**
 * Time Tracking Phase 2A — genuine render coverage (test items 31, 32,
 * 33 partial, 35, 36), same `renderToStaticMarkup` approach as
 * test/unit/record-list.test.tsx's own established precedent (this repo
 * has no DOM/component-interaction harness). TimeEntryForm itself calls
 * no next/navigation hooks (only useActionState/useState), so unlike
 * StaffRequestControls it renders cleanly under renderToStaticMarkup —
 * see that file's own doc comment for the one case that doesn't.
 */

async function noopAction(): Promise<TimeEntryFormState> {
  return { error: null };
}

const projects = [{ id: "project-a", name: "Project A" }];
const tasks = [
  { id: "task-a1", title: "Task A1", projectId: "project-a" },
  { id: "task-b1", title: "Task B1", projectId: "project-b" },
];
const members = [
  { id: "user-1", name: "Jane Owner" },
  { id: "user-2", name: "Mo Member" },
];

describe("31/32. TimeEntryForm — member selector visibility", () => {
  it("31. does not render a member selector when canSelectMember is false", () => {
    const html = renderToStaticMarkup(
      <TimeEntryForm action={noopAction} actorId="user-2" canSelectMember={false} members={[]} projects={projects} tasks={tasks} />,
    );
    expect(html).not.toContain('name="userId"><option');
    expect(html).not.toContain("Mo Member");
    // A hidden input still carries the actor's own id through.
    expect(html).toContain('type="hidden" name="userId" value="user-2"');
  });

  it("32. renders a real member <select> when canSelectMember is true", () => {
    const html = renderToStaticMarkup(
      <TimeEntryForm action={noopAction} actorId="user-1" canSelectMember={true} members={members} projects={projects} tasks={tasks} />,
    );
    expect(html).toContain("Jane Owner");
    expect(html).toContain("Mo Member");
    expect(html).toContain('id="userId"');
  });
});

describe("33. TimeEntryForm — Project -> Task filtering (initial render)", () => {
  it("only offers the selected project's own tasks, never another project's", () => {
    const html = renderToStaticMarkup(
      <TimeEntryForm
        action={noopAction}
        actorId="user-1"
        canSelectMember={false}
        members={[]}
        projects={projects}
        tasks={tasks}
        defaultValues={{ projectId: "project-a" }}
      />,
    );
    expect(html).toContain("Task A1");
    expect(html).not.toContain("Task B1");
  });

  it("offers no task options at all when no project is pre-selected", () => {
    const html = renderToStaticMarkup(
      <TimeEntryForm action={noopAction} actorId="user-1" canSelectMember={false} members={[]} projects={projects} tasks={tasks} />,
    );
    expect(html).not.toContain("Task A1");
    expect(html).not.toContain("Task B1");
  });
});

describe("35. TimeEntryForm — billable checkbox state", () => {
  it("defaults to checked when no defaultValues are given", () => {
    const html = renderToStaticMarkup(
      <TimeEntryForm action={noopAction} actorId="user-1" canSelectMember={false} members={[]} projects={projects} tasks={tasks} />,
    );
    expect(html).toMatch(/id="billable"[^>]*checked=""/);
  });

  it("reflects billable: false from defaultValues (unchecked)", () => {
    const html = renderToStaticMarkup(
      <TimeEntryForm
        action={noopAction}
        actorId="user-1"
        canSelectMember={false}
        members={[]}
        projects={projects}
        tasks={tasks}
        defaultValues={{ billable: false }}
      />,
    );
    expect(html).not.toMatch(/id="billable"[^>]*checked=""/);
  });
});

describe("36. Archived state renders clearly (StatusBadge, reused as-is)", () => {
  it("StatusBadge renders a real, visible 'Archived' badge", () => {
    const html = renderToStaticMarkup(<StatusBadge status="ARCHIVED" />);
    expect(html).toContain("Archived");
  });
});
