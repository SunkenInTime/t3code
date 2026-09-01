import { describe, expect, it } from "vite-plus/test";

import {
  buildExpandedImagePreviewFromElements,
  type ExpandedImageElement,
} from "./ExpandedImagePreview";

function image(src: string, alt: string, currentSrc = ""): ExpandedImageElement {
  return { src, currentSrc, alt };
}

describe("expanded image gallery", () => {
  it("builds a document-ordered gallery around the selected image", () => {
    const first = image("https://example.test/first.png", "First");
    const selected = image(
      "https://example.test/second-small.png",
      "  Second  ",
      "https://example.test/second-large.png",
    );
    const unnamed = image("https://example.test/third.png", "   ");

    expect(buildExpandedImagePreviewFromElements([first, selected, unnamed], selected)).toEqual({
      images: [
        { src: "https://example.test/first.png", name: "First" },
        { src: "https://example.test/second-large.png", name: "Second" },
        { src: "https://example.test/third.png", name: "image" },
      ],
      index: 1,
    });
  });

  it("uses element identity when two images have the same source", () => {
    const first = image("https://example.test/repeated.png", "Before");
    const second = image("https://example.test/repeated.png", "After");

    expect(buildExpandedImagePreviewFromElements([first, second], second)?.index).toBe(1);
  });

  it("rejects a selected element that cannot appear in the gallery", () => {
    const selected = image("  ", "Missing");

    expect(
      buildExpandedImagePreviewFromElements(
        [image("https://example.test/available.png", "Available"), selected],
        selected,
      ),
    ).toBeNull();
  });
});
