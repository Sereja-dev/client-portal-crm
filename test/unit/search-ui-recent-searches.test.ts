import { describe, it, expect, beforeEach } from "vitest";
import {
  MAX_RECENT_SEARCH_RESULTS,
  RECENT_SEARCH_RESULTS_VERSION,
  buildRecentSearchResultsStorageKey,
  isSafeInternalResultUrl,
  parseRecentSearchResults,
  readRecentSearchResults,
  addRecentSearchResult,
  clearRecentSearchResults,
  type RecentSearchResult,
} from "@/lib/search-ui/recent-searches";

/**
 * Global Search Slice B. Mirrors test/unit/saved-views-storage.test.ts's
 * own in-memory localStorage stand-in exactly — this repo's one unit-test
 * harness (vitest, environment: "node") has no real `window`/
 * `localStorage` global at all, so every test here installs a minimal
 * Map-backed stand-in on `globalThis.localStorage` before each case,
 * exercising the real module's real read/write/defensive-parse logic
 * directly, not a mock of it.
 */

class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  // @ts-expect-error -- test-only stand-in, not the real Storage interface
  globalThis.localStorage = new FakeStorage();
});

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "33333333-3333-3333-3333-333333333333";
const USER_B = "44444444-4444-4444-4444-444444444444";

function makeResult(overrides: Partial<RecentSearchResult> = {}): RecentSearchResult {
  return {
    type: "CLIENT",
    id: "c1",
    title: "Acme Corp",
    subtitle: "acme@example.com",
    url: "/clients/c1",
    ...overrides,
  };
}

describe("buildRecentSearchResultsStorageKey", () => {
  it("includes both organizationId and userId in the key", () => {
    const key = buildRecentSearchResultsStorageKey(ORG_A, USER_A);
    expect(key).toBe(`aqenra:search:recent:v1:${ORG_A}:${USER_A}`);
  });

  it("produces a different key for a different org, same user", () => {
    expect(buildRecentSearchResultsStorageKey(ORG_A, USER_A)).not.toBe(
      buildRecentSearchResultsStorageKey(ORG_B, USER_A),
    );
  });

  it("produces a different key for a different user, same org", () => {
    expect(buildRecentSearchResultsStorageKey(ORG_A, USER_A)).not.toBe(
      buildRecentSearchResultsStorageKey(ORG_A, USER_B),
    );
  });
});

describe("isSafeInternalResultUrl", () => {
  it("accepts a plain internal path", () => {
    expect(isSafeInternalResultUrl("/clients/abc")).toBe(true);
  });

  it("accepts an internal path with a query/hash", () => {
    expect(isSafeInternalResultUrl("/projects/abc?tab=activity#comment-1")).toBe(true);
  });

  it("rejects a non-string value", () => {
    expect(isSafeInternalResultUrl(42)).toBe(false);
    expect(isSafeInternalResultUrl(null)).toBe(false);
    expect(isSafeInternalResultUrl(undefined)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isSafeInternalResultUrl("")).toBe(false);
  });

  it("rejects a value with no leading slash", () => {
    expect(isSafeInternalResultUrl("clients/abc")).toBe(false);
  });

  it("rejects a protocol-relative URL", () => {
    expect(isSafeInternalResultUrl("//evil.example/x")).toBe(false);
  });

  it("rejects an absolute external URL", () => {
    expect(isSafeInternalResultUrl("https://evil.example/x")).toBe(false);
  });

  it("rejects a javascript: pseudo-URL", () => {
    expect(isSafeInternalResultUrl("/javascript:alert(1)")).toBe(false);
  });
});

describe("parseRecentSearchResults", () => {
  it("empty storage -> []", () => {
    expect(parseRecentSearchResults(null)).toEqual([]);
  });

  it("malformed JSON -> []", () => {
    expect(parseRecentSearchResults("{not json")).toEqual([]);
  });

  it("wrong version -> []", () => {
    const raw = JSON.stringify({ version: 999, results: [makeResult()] });
    expect(parseRecentSearchResults(raw)).toEqual([]);
  });

  it("non-object root -> []", () => {
    expect(parseRecentSearchResults(JSON.stringify([1, 2, 3]))).toEqual([]);
    expect(parseRecentSearchResults(JSON.stringify("just a string"))).toEqual([]);
  });

  it("non-array results field -> []", () => {
    const raw = JSON.stringify({ version: RECENT_SEARCH_RESULTS_VERSION, results: "nope" });
    expect(parseRecentSearchResults(raw)).toEqual([]);
  });

  it("drops an entry with an unknown type, keeps the valid ones", () => {
    const raw = JSON.stringify({
      version: RECENT_SEARCH_RESULTS_VERSION,
      results: [makeResult({ id: "ok" }), { ...makeResult({ id: "bad" }), type: "LEAD" }],
    });
    const parsed = parseRecentSearchResults(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("ok");
  });

  it("drops an entry missing id/title/url, keeps the valid ones", () => {
    const raw = JSON.stringify({
      version: RECENT_SEARCH_RESULTS_VERSION,
      results: [
        makeResult({ id: "ok" }),
        { type: "CLIENT", title: "No id", subtitle: null, url: "/clients/x" },
        { type: "CLIENT", id: "no-title", subtitle: null, url: "/clients/y" },
        { type: "CLIENT", id: "no-url", title: "No url", subtitle: null },
      ],
    });
    const parsed = parseRecentSearchResults(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("ok");
  });

  it("drops an entry with an unsafe/external url, keeps the valid ones", () => {
    const raw = JSON.stringify({
      version: RECENT_SEARCH_RESULTS_VERSION,
      results: [makeResult({ id: "ok" }), makeResult({ id: "bad", url: "https://evil.example/x" })],
    });
    const parsed = parseRecentSearchResults(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("ok");
  });
});

describe("addRecentSearchResult", () => {
  it("empty storage, add one item", () => {
    const next = addRecentSearchResult(ORG_A, USER_A, makeResult({ id: "c1" }));
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("c1");
  });

  it("newest-first", () => {
    addRecentSearchResult(ORG_A, USER_A, makeResult({ id: "c1" }));
    const next = addRecentSearchResult(ORG_A, USER_A, makeResult({ id: "c2" }));
    expect(next.map((r) => r.id)).toEqual(["c2", "c1"]);
  });

  it("dedupes the same type+id instead of appending a duplicate", () => {
    addRecentSearchResult(ORG_A, USER_A, makeResult({ id: "c1", title: "Old title" }));
    addRecentSearchResult(ORG_A, USER_A, makeResult({ id: "c2" }));
    const next = addRecentSearchResult(ORG_A, USER_A, makeResult({ id: "c1", title: "New title" }));
    expect(next).toHaveLength(2);
    expect(next.filter((r) => r.id === "c1")).toHaveLength(1);
  });

  it("re-selecting an existing item moves it to the front with its latest metadata", () => {
    addRecentSearchResult(ORG_A, USER_A, makeResult({ id: "c1" }));
    addRecentSearchResult(ORG_A, USER_A, makeResult({ id: "c2" }));
    const next = addRecentSearchResult(ORG_A, USER_A, makeResult({ id: "c1", title: "Renamed" }));
    expect(next.map((r) => r.id)).toEqual(["c1", "c2"]);
    expect(next[0].title).toBe("Renamed");
  });

  it("a different type with the same id is never treated as a duplicate", () => {
    addRecentSearchResult(ORG_A, USER_A, makeResult({ type: "CLIENT", id: "same-id" }));
    const next = addRecentSearchResult(ORG_A, USER_A, makeResult({ type: "PROJECT", id: "same-id" }));
    expect(next).toHaveLength(2);
  });

  it("bounded to MAX_RECENT_SEARCH_RESULTS (6)", () => {
    expect(MAX_RECENT_SEARCH_RESULTS).toBe(6);
    let next: RecentSearchResult[] = [];
    for (let i = 0; i < 10; i += 1) {
      next = addRecentSearchResult(ORG_A, USER_A, makeResult({ id: `c${i}` }));
    }
    expect(next).toHaveLength(6);
    // Newest-first, so the 6 most recent (c9..c4) survive, oldest (c0..c3) are trimmed.
    expect(next.map((r) => r.id)).toEqual(["c9", "c8", "c7", "c6", "c5", "c4"]);
  });

  it("isolates by organizationId: same user, different org never sees the other org's recents", () => {
    addRecentSearchResult(ORG_A, USER_A, makeResult({ id: "c1" }));
    const orgBResults = readRecentSearchResults(ORG_B, USER_A);
    expect(orgBResults).toEqual([]);
  });

  it("isolates by userId: same org, different user never sees the other user's recents", () => {
    addRecentSearchResult(ORG_A, USER_A, makeResult({ id: "c1" }));
    const userBResults = readRecentSearchResults(ORG_A, USER_B);
    expect(userBResults).toEqual([]);
  });
});

describe("clearRecentSearchResults", () => {
  it("removes only the current org+user scoped key", () => {
    addRecentSearchResult(ORG_A, USER_A, makeResult({ id: "c1" }));
    addRecentSearchResult(ORG_A, USER_B, makeResult({ id: "c2" }));
    addRecentSearchResult(ORG_B, USER_A, makeResult({ id: "c3" }));

    clearRecentSearchResults(ORG_A, USER_A);

    expect(readRecentSearchResults(ORG_A, USER_A)).toEqual([]);
    // Every other org+user scope is untouched.
    expect(readRecentSearchResults(ORG_A, USER_B)).toHaveLength(1);
    expect(readRecentSearchResults(ORG_B, USER_A)).toHaveLength(1);
  });

  it("does not throw when there was nothing to clear", () => {
    expect(() => clearRecentSearchResults(ORG_A, USER_A)).not.toThrow();
  });
});

describe("storage exceptions fail gracefully", () => {
  it("readRecentSearchResults returns [] when localStorage throws", () => {
    // @ts-expect-error -- deliberately malformed stand-in for this one test
    globalThis.localStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readRecentSearchResults(ORG_A, USER_A)).toEqual([]);
  });

  it("addRecentSearchResult still returns the computed list even when the underlying write throws", () => {
    const fake = new FakeStorage();
    // @ts-expect-error -- deliberately malformed stand-in for this one test
    globalThis.localStorage = {
      getItem: fake.getItem.bind(fake),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => addRecentSearchResult(ORG_A, USER_A, makeResult())).not.toThrow();
    const next = addRecentSearchResult(ORG_A, USER_A, makeResult());
    expect(next).toHaveLength(1);
  });
});
