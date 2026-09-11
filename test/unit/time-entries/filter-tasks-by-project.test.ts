import { describe, expect, it } from "vitest";
import { filterTasksByProject, isTaskValidForProject, type TimeEntryTaskOption } from "@/components/time-entries/filter-tasks-by-project";

const tasks: TimeEntryTaskOption[] = [
  { id: "task-a1", title: "Task A1", projectId: "project-a" },
  { id: "task-a2", title: "Task A2", projectId: "project-a" },
  { id: "task-b1", title: "Task B1", projectId: "project-b" },
];

describe("33. filterTasksByProject", () => {
  it("only returns tasks belonging to the given project", () => {
    expect(filterTasksByProject(tasks, "project-a").map((t) => t.id)).toEqual(["task-a1", "task-a2"]);
    expect(filterTasksByProject(tasks, "project-b").map((t) => t.id)).toEqual(["task-b1"]);
  });

  it("returns an empty array when no project is selected — never 'all tasks'", () => {
    expect(filterTasksByProject(tasks, null)).toEqual([]);
    expect(filterTasksByProject(tasks, "")).toEqual([]);
  });

  it("returns an empty array for a project with no tasks", () => {
    expect(filterTasksByProject(tasks, "project-c")).toEqual([]);
  });
});

describe("isTaskValidForProject", () => {
  it("true when the task belongs to the given project", () => {
    expect(isTaskValidForProject(tasks, "task-a1", "project-a")).toBe(true);
  });

  it("false when the task belongs to a different project", () => {
    expect(isTaskValidForProject(tasks, "task-a1", "project-b")).toBe(false);
  });

  it("false when no project is selected", () => {
    expect(isTaskValidForProject(tasks, "task-a1", null)).toBe(false);
  });

  it("false for a nonexistent task id", () => {
    expect(isTaskValidForProject(tasks, "nonexistent", "project-a")).toBe(false);
  });
});
