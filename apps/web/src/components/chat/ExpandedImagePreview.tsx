import type { ComposerFileAttachment } from "../../composerDraftStore";
import { type ChatImageAttachment, isVideoAttachment } from "../../types";

export interface ExpandedImageItem {
  src: string;
  name: string;
  type?: "video";
}

export interface ExpandedImagePreview {
  images: ExpandedImageItem[];
  index: number;
}

export interface ExpandedImageElement {
  readonly src: string;
  readonly currentSrc: string;
  readonly alt: string;
}

export const EXPANDED_IMAGE_ELEMENT_PROPS = { "data-expanded-image": "" } as const;

const EXPANDED_IMAGE_ELEMENT_SELECTOR = "img[data-expanded-image]";

export function attachVideoThumbnail(video: HTMLVideoElement, file: File): () => void {
  const url = URL.createObjectURL(file);
  video.src = url;
  return () => URL.revokeObjectURL(url);
}

export async function downloadVideoPreview(src: string, name: string): Promise<void> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Could not download video (${response.status}).`);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function buildExpandedImagePreview(
  images: ReadonlyArray<ChatImageAttachment | ComposerFileAttachment>,
  selectedImageId: string,
): ExpandedImagePreview | null {
  const selected = images.find((image) => image.id === selectedImageId);
  if (selected?.type === "file" && selected.file && isVideoAttachment(selected)) {
    return {
      images: [{ src: URL.createObjectURL(selected.file), name: selected.name, type: "video" }],
      index: 0,
    };
  }
  const previewableImages = images.flatMap((image) =>
    image.type === "image" && image.previewUrl
      ? [{ id: image.id, src: image.previewUrl, name: image.name }]
      : [],
  );
  if (previewableImages.length === 0) {
    return null;
  }
  const selectedIndex = previewableImages.findIndex((image) => image.id === selectedImageId);
  if (selectedIndex < 0) {
    return null;
  }
  return {
    images: previewableImages.map((image) => ({
      src: image.src,
      name: image.name,
    })),
    index: selectedIndex,
  };
}

export function buildExpandedImagePreviewFromElements(
  images: ReadonlyArray<ExpandedImageElement>,
  selectedImage: ExpandedImageElement,
): ExpandedImagePreview | null {
  const previewableImages = images.flatMap((image) => {
    const src = image.currentSrc.trim() || image.src.trim();
    return src.length === 0
      ? []
      : [{ element: image, item: { src, name: image.alt.trim() || "image" } }];
  });
  const selectedIndex = previewableImages.findIndex(({ element }) => element === selectedImage);
  if (selectedIndex < 0) return null;
  return {
    images: previewableImages.map(({ item }) => item),
    index: selectedIndex,
  };
}

export function buildExpandedImagePreviewFromContainer(
  container: ParentNode,
  selectedImage: HTMLImageElement,
): ExpandedImagePreview | null {
  return buildExpandedImagePreviewFromElements(
    [...container.querySelectorAll<HTMLImageElement>(EXPANDED_IMAGE_ELEMENT_SELECTOR)],
    selectedImage,
  );
}
