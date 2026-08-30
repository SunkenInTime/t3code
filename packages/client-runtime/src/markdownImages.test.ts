import { describe, expect, it } from "vite-plus/test";

import {
  classifyMarkdownImageSource,
  markdownImageSourceFragment,
  MARKDOWN_IMAGE_MAX_HEIGHT,
  MARKDOWN_IMAGE_MAX_WIDTH,
  resolveMarkdownImageDisplaySize,
} from "./markdownImages.js";

describe("classifyMarkdownImageSource", () => {
  it.each([
    "https://example.com/image.png",
    "HTTP://example.com/image.png",
    "data:image/png;base64,AAAA",
    "blob:https://app.t3.codes/image-id",
    "//cdn.example.com/image.png",
  ])("keeps %s directly loadable", (uri) => {
    expect(classifyMarkdownImageSource(uri, "/workspace/project")).toEqual({
      _tag: "Direct",
      uri,
    });
  });

  it.each([
    ["images/result.png", "/workspace/project", "/workspace/project/images/result.png"],
    ["./images/result.png", "/workspace/project", "/workspace/project/./images/result.png"],
    [
      "images/result.png",
      "C:\\Users\\dara\\project",
      "C:\\Users\\dara\\project\\images\\result.png",
    ],
    [
      "images\\result.png",
      "C:\\Users\\dara\\project",
      "C:\\Users\\dara\\project\\images\\result.png",
    ],
    ["/workspace/project/image.png", null, "/workspace/project/image.png"],
    ["/C:/Users/dara/project/image.png", null, "C:/Users/dara/project/image.png"],
    ["C:/Users/dara/project/image.png", null, "C:/Users/dara/project/image.png"],
    ["\\\\server\\share\\image.png", null, "\\\\server\\share\\image.png"],
    ["file:///workspace/project/image%20one.png", null, "/workspace/project/image one.png"],
    ["file:///C:/Users/dara/project/image.png", null, "C:/Users/dara/project/image.png"],
    ["file://localhost/C:/Users/dara/project/image.png", null, "C:/Users/dara/project/image.png"],
    ["file://server/share/image.png", null, "\\\\server\\share\\image.png"],
  ])("maps %s to a workspace file", (source, workspaceRoot, path) => {
    expect(classifyMarkdownImageSource(source, workspaceRoot)).toEqual({
      _tag: "WorkspaceFile",
      path,
    });
  });

  it.each([
    null,
    "",
    "#image",
    "?image=1",
    "image.png",
    "~/image.png",
    "javascript:alert(1)",
    "ftp://example.com/image.png",
    "content://media/image/1",
    "custom:image.png",
    "file://%",
  ])("blocks unsupported or unresolved source %s", (source) => {
    expect(classifyMarkdownImageSource(source)).toEqual({ _tag: "Blocked" });
  });
});

describe("markdownImageSourceFragment", () => {
  it.each([
    ["<icons.svg?version=2#logo>", "#logo"],
    ["icons.svg?version=2", ""],
  ])("extracts %s as %s", (source, fragment) => {
    expect(markdownImageSourceFragment(source)).toBe(fragment);
  });
});

describe("resolveMarkdownImageDisplaySize", () => {
  it("keeps small images at their intrinsic size", () => {
    expect(
      resolveMarkdownImageDisplaySize({
        sourceWidth: 96,
        sourceHeight: 96,
        availableWidth: 332,
      }),
    ).toEqual({ width: 96, height: 96 });
  });

  it("fits wide images to the available markdown width", () => {
    expect(
      resolveMarkdownImageDisplaySize({
        sourceWidth: 960,
        sourceHeight: 540,
        availableWidth: 332,
      }),
    ).toEqual({ width: 332, height: 186.75 });
  });

  it("caps wide images at 480 points on larger screens", () => {
    expect(
      resolveMarkdownImageDisplaySize({
        sourceWidth: 960,
        sourceHeight: 540,
        availableWidth: 900,
      }),
    ).toEqual({ width: MARKDOWN_IMAGE_MAX_WIDTH, height: 270 });
  });

  it("caps tall images by height without changing their aspect ratio", () => {
    expect(
      resolveMarkdownImageDisplaySize({
        sourceWidth: 400,
        sourceHeight: 800,
        availableWidth: 332,
      }),
    ).toEqual({ width: 240, height: MARKDOWN_IMAGE_MAX_HEIGHT });
  });

  it("rejects dimensions that cannot produce a stable layout", () => {
    expect(
      resolveMarkdownImageDisplaySize({ sourceWidth: 0, sourceHeight: 100, availableWidth: 332 }),
    ).toBeNull();
    expect(
      resolveMarkdownImageDisplaySize({
        sourceWidth: 100,
        sourceHeight: Number.NaN,
        availableWidth: 332,
      }),
    ).toBeNull();
  });
});
