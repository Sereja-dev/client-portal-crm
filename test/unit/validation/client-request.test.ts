import { describe, expect, it } from "vitest";
import {
  parseClientRequestCreateInput,
  isClientRequestStatus,
  isClientRequestPriority,
  isPortalSelectableClientRequestPriority,
  deriveClientRequestResolvedAt,
  CLIENT_REQUEST_PRIORITIES,
  PORTAL_SELECTABLE_CLIENT_REQUEST_PRIORITIES,
  CLIENT_REQUEST_TITLE_MAX_LENGTH,
  CLIENT_REQUEST_DESCRIPTION_MAX_LENGTH,
} from "@/lib/validation/client-request";

describe("isClientRequestStatus / isClientRequestPriority", () => {
  it("accepts every real enum value and rejects everything else", () => {
    for (const status of ["OPEN", "IN_PROGRESS", "WAITING_ON_CLIENT", "RESOLVED", "CLOSED"]) {
      expect(isClientRequestStatus(status)).toBe(true);
    }
    expect(isClientRequestStatus("DELETED")).toBe(false);
    expect(isClientRequestStatus(null)).toBe(false);
    expect(isClientRequestStatus(42)).toBe(false);
  });

  it("22/24. rejects an invalid status/priority value", () => {
    expect(isClientRequestStatus("open")).toBe(false); // case-sensitive
    expect(isClientRequestPriority("MEDIUM")).toBe(false); // TaskPriority's own value, not this enum's
  });

  it("accepts every real priority value", () => {
    for (const priority of CLIENT_REQUEST_PRIORITIES) {
      expect(isClientRequestPriority(priority)).toBe(true);
    }
  });
});

describe("isPortalSelectableClientRequestPriority", () => {
  it("accepts LOW/NORMAL/HIGH but rejects URGENT — reserved for Staff", () => {
    for (const priority of PORTAL_SELECTABLE_CLIENT_REQUEST_PRIORITIES) {
      expect(isPortalSelectableClientRequestPriority(priority)).toBe(true);
    }
    expect(isPortalSelectableClientRequestPriority("URGENT")).toBe(false);
  });
});

describe("parseClientRequestCreateInput", () => {
  it("2/3. defaults priority to NORMAL when omitted", () => {
    const result = parseClientRequestCreateInput({ title: "Site is down", description: "Nothing loads." }, CLIENT_REQUEST_PRIORITIES);
    expect(result).toEqual({ ok: true, values: { title: "Site is down", description: "Nothing loads.", priority: "NORMAL", projectId: null } });
  });

  it("requires a non-empty, non-whitespace-only title", () => {
    const result = parseClientRequestCreateInput({ title: "   ", description: "Body" }, CLIENT_REQUEST_PRIORITIES);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.title).toBeTruthy();
  });

  it("requires a non-empty, non-whitespace-only description", () => {
    const result = parseClientRequestCreateInput({ title: "Title", description: "   " }, CLIENT_REQUEST_PRIORITIES);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.description).toBeTruthy();
  });

  it("rejects an over-length title/description", () => {
    const result = parseClientRequestCreateInput(
      { title: "a".repeat(CLIENT_REQUEST_TITLE_MAX_LENGTH + 1), description: "b".repeat(CLIENT_REQUEST_DESCRIPTION_MAX_LENGTH + 1) },
      CLIENT_REQUEST_PRIORITIES,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.title).toBeTruthy();
    expect(result.fieldErrors.description).toBeTruthy();
  });

  it("trims title/description", () => {
    const result = parseClientRequestCreateInput({ title: "  Title  ", description: "  Body  " }, CLIENT_REQUEST_PRIORITIES);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.values.title).toBe("Title");
    expect(result.values.description).toBe("Body");
  });

  it("respects the caller's own allowedPriorities list (Portal's own restricted set)", () => {
    const result = parseClientRequestCreateInput(
      { title: "Title", description: "Body", priority: "URGENT" },
      PORTAL_SELECTABLE_CLIENT_REQUEST_PRIORITIES,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.priority).toBeTruthy();
  });

  it("accepts a priority within the caller's own allowedPriorities list", () => {
    const result = parseClientRequestCreateInput(
      { title: "Title", description: "Body", priority: "HIGH" },
      PORTAL_SELECTABLE_CLIENT_REQUEST_PRIORITIES,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.values.priority).toBe("HIGH");
  });

  it("rejects a malformed projectId (not a well-formed UUID)", () => {
    const result = parseClientRequestCreateInput({ title: "Title", description: "Body", projectId: "not-a-uuid" }, CLIENT_REQUEST_PRIORITIES);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.projectId).toBeTruthy();
  });

  it("accepts an absent projectId as null", () => {
    const result = parseClientRequestCreateInput({ title: "Title", description: "Body" }, CLIENT_REQUEST_PRIORITIES);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.values.projectId).toBeNull();
  });
});

describe("deriveClientRequestResolvedAt", () => {
  it("21. sets resolvedAt when moving to RESOLVED for the first time", () => {
    const result = deriveClientRequestResolvedAt("RESOLVED", null);
    expect(result).toBeInstanceOf(Date);
  });

  it("never bumps an already-set resolvedAt on a repeat RESOLVED save", () => {
    const existing = new Date("2026-01-01T00:00:00Z");
    expect(deriveClientRequestResolvedAt("RESOLVED", existing)).toBe(existing);
  });

  it("21. CLOSED never sets or clears resolvedAt on its own", () => {
    expect(deriveClientRequestResolvedAt("CLOSED", null)).toBeNull();
    const existing = new Date("2026-01-01T00:00:00Z");
    expect(deriveClientRequestResolvedAt("CLOSED", existing)).toBe(existing);
  });

  it("clears resolvedAt when reopened to any non-terminal status", () => {
    const existing = new Date("2026-01-01T00:00:00Z");
    expect(deriveClientRequestResolvedAt("OPEN", existing)).toBeNull();
    expect(deriveClientRequestResolvedAt("IN_PROGRESS", existing)).toBeNull();
    expect(deriveClientRequestResolvedAt("WAITING_ON_CLIENT", existing)).toBeNull();
  });
});
