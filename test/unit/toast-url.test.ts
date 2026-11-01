import { describe, expect, it } from "vitest";
import { withToast } from "@/lib/toast-url";

describe("withToast", () => {
  it("appends the toast to a plain path", () => {
    expect(withToast("/tasks", "Task created")).toBe("/tasks?toast=Task+created");
  });

  it("keeps an existing query (e.g. the Project Hub tab) intact", () => {
    expect(withToast("/projects/abc?tab=tasks", "Task created")).toBe("/projects/abc?tab=tasks&toast=Task+created");
  });

  it("adds the error variant after the message", () => {
    expect(withToast("/tasks", "Nope", "error")).toBe("/tasks?toast=Nope&toastVariant=error");
  });
});
