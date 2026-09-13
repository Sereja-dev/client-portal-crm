import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import { FIXED_NOW } from "../support/fixtures";

// src/lib/timeline/format-note.ts imports src/lib/timeline/notes.ts,
// which imports the real "server-only" package — outside Next's own
// react-server condition (this plain Vitest unit run), that package
// throws on import. Same established per-file mock this repo already
// uses elsewhere (e.g. test/unit/billing-provider-availability.test.ts)
// for the identical situation. vi.mock calls are hoisted above imports
// by Vitest automatically, so the static import below still sees the
// mocked module.
vi.mock("server-only", () => ({}));

const { formatTimelineNoteViewModel, resolveTimelineNotePermissions } = await import("@/lib/timeline/format-note");

function actor(id: string, role: Role = "MEMBER"): { id: string; name: string; role: Role } {
  return { id, name: `User ${id}`, role };
}

describe("formatTimelineNoteViewModel", () => {
  const baseInput = {
    id: "note-1",
    authorId: "user-1",
    author: { name: "Jane Doe" },
    body: "Called about renewal.",
    editedAt: null,
    createdAt: FIXED_NOW,
  };

  it("a normal, unedited note", () => {
    const result = formatTimelineNoteViewModel(baseInput);
    expect(result.authorName).toBe("Jane Doe");
    expect(result.isEdited).toBe(false);
    expect(result.body).toBe("Called about renewal.");
    expect(result.editedAt).toBeNull();
  });

  it("an edited note sets isEdited", () => {
    const result = formatTimelineNoteViewModel({ ...baseInput, editedAt: FIXED_NOW });
    expect(result.isEdited).toBe(true);
    expect(result.editedAt).toBe(FIXED_NOW);
  });

  it("an author whose User row is gone (authorId null, author null) falls back to a neutral label, matching Comment's own precedent", () => {
    const result = formatTimelineNoteViewModel({ ...baseInput, authorId: null, author: null });
    expect(result.authorName).toBe("Deleted user");
    expect(result.authorId).toBeNull();
  });

  it("never throws on an unusual body", () => {
    expect(() => formatTimelineNoteViewModel({ ...baseInput, body: "@[".repeat(5000) })).not.toThrow();
  });
});

describe("resolveTimelineNotePermissions", () => {
  const authoredByUser1 = { authorId: "user-1" };

  it("the author can edit and delete their own note, regardless of role", () => {
    expect(resolveTimelineNotePermissions(authoredByUser1, actor("user-1", "MEMBER"))).toEqual({
      canEdit: true,
      canDelete: true,
    });
    expect(resolveTimelineNotePermissions(authoredByUser1, actor("user-1", "OWNER"))).toEqual({
      canEdit: true,
      canDelete: true,
    });
  });

  it("a plain MEMBER (non-author) can neither edit nor delete someone else's note", () => {
    expect(resolveTimelineNotePermissions(authoredByUser1, actor("user-2", "MEMBER"))).toEqual({
      canEdit: false,
      canDelete: false,
    });
  });

  it("OWNER can edit and delete someone else's note (moderation)", () => {
    expect(resolveTimelineNotePermissions(authoredByUser1, actor("user-2", "OWNER"))).toEqual({
      canEdit: true,
      canDelete: true,
    });
  });

  it("ADMIN can edit and delete someone else's note (moderation)", () => {
    expect(resolveTimelineNotePermissions(authoredByUser1, actor("user-2", "ADMIN"))).toEqual({
      canEdit: true,
      canDelete: true,
    });
  });

  it("an authorless (author-deleted) note grants only OWNER/ADMIN edit/delete, never a plain MEMBER", () => {
    const authorless = { authorId: null };
    expect(resolveTimelineNotePermissions(authorless, actor("user-2", "OWNER"))).toEqual({
      canEdit: true,
      canDelete: true,
    });
    expect(resolveTimelineNotePermissions(authorless, actor("user-2", "MEMBER"))).toEqual({
      canEdit: false,
      canDelete: false,
    });
  });
});
