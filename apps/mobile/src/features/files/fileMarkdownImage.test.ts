import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveFileMarkdownImage } from "./fileMarkdownImage";

const threadId = ThreadId.make("thread-1");

describe("resolveFileMarkdownImage", () => {
  it("resolves local images from the Markdown file's directory", () => {
    expect(
      resolveFileMarkdownImage({
        cwd: "/workspace/project",
        relativePath: "docs/README.md",
        href: "images/diagram.png",
        threadId,
      }),
    ).toMatchObject({
      kind: "image",
      access: "environment",
      resource: {
        _tag: "media-file",
        threadId,
        path: "/workspace/project/docs/images/diagram.png",
      },
    });
  });

  it("leaves external images on the existing renderer", () => {
    expect(
      resolveFileMarkdownImage({
        cwd: "/workspace/project",
        relativePath: "docs/README.md",
        href: "https://example.com/diagram.png",
        threadId,
      }),
    ).toMatchObject({
      kind: "image",
      access: "direct",
      uri: "https://example.com/diagram.png",
    });
  });
});
