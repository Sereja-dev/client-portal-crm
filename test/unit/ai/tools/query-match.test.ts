import { describe, expect, it } from "vitest";
import { tokenizeAiSearchQuery } from "@/lib/ai/tools/query-match";

describe("tokenizeAiSearchQuery — pure, deterministic query tokenization", () => {
  it("trims surrounding whitespace", () => {
    expect(tokenizeAiSearchQuery("   Brightline Robotics   ")).toEqual(["Brightline", "Robotics"]);
  });

  it("collapses repeated internal whitespace (including tabs/newlines) to single-space token boundaries", () => {
    expect(tokenizeAiSearchQuery("Brightline    Robotics\tWarehouse\nAutomation  Pilot")).toEqual([
      "Brightline",
      "Robotics",
      "Warehouse",
      "Automation",
      "Pilot",
    ]);
  });

  it("splits a normal multi-word entity query into one token per word", () => {
    expect(tokenizeAiSearchQuery("Brightline Robotics Warehouse Automation Pilot")).toEqual([
      "Brightline",
      "Robotics",
      "Warehouse",
      "Automation",
      "Pilot",
    ]);
  });

  it("keeps a hyphenated invoice number as exactly one token — never splits on hyphens", () => {
    expect(tokenizeAiSearchQuery("INV-1004")).toEqual(["INV-1004"]);
    expect(tokenizeAiSearchQuery("Find INV-1004 please")).toEqual(["Find", "INV-1004", "please"]);
  });

  it("preserves an internal apostrophe in a name (e.g. O'Brien) — never corrupts it", () => {
    expect(tokenizeAiSearchQuery("O'Brien")).toEqual(["O'Brien"]);
    expect(tokenizeAiSearchQuery("the O'Brien account")).toEqual(["the", "O'Brien", "account"]);
  });

  it("strips a trailing possessive apostrophe/wrapping punctuation from a token", () => {
    expect(tokenizeAiSearchQuery("Robotics' project")).toEqual(["Robotics", "project"]);
    expect(tokenizeAiSearchQuery("(Brightline Robotics), please")).toEqual(["Brightline", "Robotics", "please"]);
  });

  it("discards a token that becomes empty after stripping wrapping punctuation", () => {
    expect(tokenizeAiSearchQuery("Brightline , , Robotics")).toEqual(["Brightline", "Robotics"]);
  });

  it("discards a token that is entirely punctuation (e.g. a lone hyphen), while still preserving a hyphen INSIDE a real token", () => {
    expect(tokenizeAiSearchQuery("Brightline - Robotics")).toEqual(["Brightline", "Robotics"]);
    expect(tokenizeAiSearchQuery("INV-1004")).toEqual(["INV-1004"]);
  });

  it("returns an empty array for an empty or whitespace-only query", () => {
    expect(tokenizeAiSearchQuery("")).toEqual([]);
    expect(tokenizeAiSearchQuery("   ")).toEqual([]);
    expect(tokenizeAiSearchQuery("\t\n")).toEqual([]);
  });

  it("produces deterministic, identical tokens for equivalent whitespace-variant input", () => {
    const a = tokenizeAiSearchQuery("Brightline   Robotics");
    const b = tokenizeAiSearchQuery(" Brightline Robotics ");
    const c = tokenizeAiSearchQuery("Brightline\tRobotics");
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("preserves case — this function never lowercases; case-insensitivity is each caller's own concern", () => {
    expect(tokenizeAiSearchQuery("BrightLine ROBOTICS")).toEqual(["BrightLine", "ROBOTICS"]);
  });
});
