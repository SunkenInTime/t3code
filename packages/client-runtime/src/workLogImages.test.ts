import { describe, expect, it } from "vite-plus/test";

import {
  type ViewedImageWorkEntry,
  workEntryIsRead,
  workEntryViewedImagePath,
} from "./workLogImages.js";

describe("workEntryIsRead", () => {
  it("uses one predicate for file reads, image views, and dynamic read tools", () => {
    expect(workEntryIsRead({ requestKind: "file-read" })).toBe(true);
    expect(workEntryIsRead({ itemType: "image_view" })).toBe(true);
    expect(workEntryIsRead({ itemType: "dynamic_tool_call", toolTitle: " Read File " })).toBe(true);
    expect(workEntryIsRead({ itemType: "command_execution" })).toBe(false);
  });
});

describe("workEntryViewedImagePath", () => {
  const readEntry = (overrides: ViewedImageWorkEntry): ViewedImageWorkEntry => ({
    itemType: "image_view",
    ...overrides,
  });

  it("returns the detail path for image_view entries", () => {
    const entry = readEntry({ detail: "/workspace/screenshots/after.png" });
    expect(workEntryViewedImagePath(entry)).toBe("/workspace/screenshots/after.png");
  });

  it("returns the path for file-read entries that read an image", () => {
    const entry: ViewedImageWorkEntry = {
      requestKind: "file-read",
      detail: "assets/logo.webp",
    };
    expect(workEntryViewedImagePath(entry)).toBe("assets/logo.webp");
  });

  it("returns the path for dynamic reads with sentence-case titles", () => {
    const entry = readEntry({
      itemType: "dynamic_tool_call",
      toolTitle: "Read file",
      detail: "artifacts/cursor-preview.png",
    });
    expect(workEntryViewedImagePath(entry)).toBe("artifacts/cursor-preview.png");
  });

  it("ignores non-image details", () => {
    expect(workEntryViewedImagePath(readEntry({ detail: "src/index.ts" }))).toBeNull();
  });

  it("ignores multi-line details", () => {
    expect(workEntryViewedImagePath(readEntry({ detail: "a.png\nb.png" }))).toBeNull();
    expect(workEntryViewedImagePath(readEntry({ detail: "a.png\rb.png" }))).toBeNull();
  });

  it("ignores entries that are not reads", () => {
    const entry = readEntry({ itemType: "command_execution", detail: "shot.png" });
    expect(workEntryViewedImagePath(entry)).toBeNull();
  });

  it("ignores entries without detail", () => {
    expect(workEntryViewedImagePath(readEntry({}))).toBeNull();
  });
});
