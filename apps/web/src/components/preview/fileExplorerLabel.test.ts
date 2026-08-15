import { describe, expect, it } from "vite-plus/test";

import { revealInFileExplorerLabel, revealInFileExplorerLabelForOs } from "./fileExplorerLabel";

describe("revealInFileExplorerLabel", () => {
  it.each([
    ["MacIntel", "Reveal in Finder"],
    ["Win32", "Reveal in File Explorer"],
    ["Linux x86_64", "Reveal in Files"],
  ])("maps %s to %s", (platform, expected) => {
    expect(revealInFileExplorerLabel(platform)).toBe(expected);
  });
});

describe("revealInFileExplorerLabelForOs", () => {
  it.each([
    ["darwin", "Reveal in Finder"],
    ["windows", "Reveal in File Explorer"],
    ["linux", "Reveal in Files"],
    ["unknown", "Reveal in Files"],
  ] as const)("maps %s to %s", (os, expected) => {
    expect(revealInFileExplorerLabelForOs(os)).toBe(expected);
  });
});
