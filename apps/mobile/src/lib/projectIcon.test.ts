import { describe, expect, it } from "vite-plus/test";

import { countGlyphs, projectMonogram, resolveProjectIconGlyph } from "./projectIcon";

describe("resolveProjectIconGlyph", () => {
  it("returns null without an override so the favicon path is used", () => {
    expect(resolveProjectIconGlyph(null, "nebula")).toBeNull();
    expect(resolveProjectIconGlyph(undefined, "nebula")).toBeNull();
  });

  it("passes emoji and monogram overrides through", () => {
    expect(resolveProjectIconGlyph({ kind: "emoji", emoji: "🍎" }, "silver-orchard")).toEqual({
      kind: "emoji",
      emoji: "🍎",
    });
    expect(
      resolveProjectIconGlyph({ kind: "monogram", text: "M7", color: "orange" }, "m7-forge"),
    ).toEqual({ kind: "monogram", text: "M7", color: "orange" });
  });

  it("turns a lucide override into a monogram that keeps the chosen color", () => {
    expect(
      resolveProjectIconGlyph({ kind: "lucide", name: "rocket", color: "violet" }, "nebula"),
    ).toEqual({ kind: "monogram", text: "NA", color: "violet" });
  });
});

describe("countGlyphs", () => {
  it("folds combining marks into their base character", () => {
    expect(countGlyphs("e\u0301")).toBe(1);
    expect(countGlyphs("\u0915\u093F")).toBe(1);
    expect(countGlyphs("M7")).toBe(2);
  });
});

describe("projectMonogram", () => {
  it.each([
    ["nebula", "NA"],
    ["silver-orchard", "SO"],
    ["m7-forge", "M7"],
    ["t3code", "T3"],
    ["  ", "PR"],
  ])("derives %s -> %s", (title, expected) => {
    expect(projectMonogram(title)).toBe(expected);
  });
});
