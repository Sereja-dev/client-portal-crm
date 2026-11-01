import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// First-Time User Experience V2, Slice B — source contract for the explicit
// project-return context: only the exact `from=project`, never projectId
// alone, never a URL; Cancel follows the server-verified origin project.

const read = (path: string) => readFileSync(path, "utf8");
const tab = read("src/app/(dashboard)/projects/[id]/project-tasks-tab.tsx");
const page = read("src/app/(dashboard)/tasks/new/page.tsx");
const form = read("src/components/tasks/task-form.tsx");
const action = read("src/app/(dashboard)/tasks/new/actions.ts");

describe("Task create — project-return context contract", () => {
  it("both Project Hub Add task links send the explicit from=project context", () => {
    const links = tab.match(/\/tasks\/new\?[^`"]*/g) ?? [];
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toBe("/tasks/new?projectId=${projectId}&from=project");
  });

  it("the global entry points stay bare", () => {
    expect(read("src/app/(dashboard)/tasks/page.tsx")).not.toMatch(/from=project/);
  });

  it("the page opts in only on the exact from=project and resolves the origin inside the org's own project list", () => {
    expect(page).toContain('resolvedSearchParams.from === "project"');
    expect(page).toMatch(/fromProject \? \(projects\.find\(\(p\) => p\.id === projectId\)/);
    expect(page).toContain("`/projects/${originProjectId}?tab=tasks`");
    expect(page).toContain('returnTo={originProjectId ? "project" : undefined}');
  });

  it("the form emits only the literal hidden returnTo=project, and only when asked", () => {
    expect(form).toContain('returnTo?: "project"');
    expect(form).toContain('{returnTo === "project" && <input type="hidden" name="returnTo" value="project" />}');
  });

  it("the action redirects to the Hub only for the literal 'project', built from the verified project id", () => {
    expect(action).toContain('formData.get("returnTo") === "project"');
    expect(action).toContain("`/projects/${project.id}?tab=tasks`");
    expect(action).toContain('redirect(withToast("/tasks", "Task created"))');
    expect(action).not.toMatch(/redirect\([^)]*formData\.get\("(returnTo|redirect|next|url)"\)/);
  });
});
