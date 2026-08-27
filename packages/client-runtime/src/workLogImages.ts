import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";

export interface ViewedImageWorkEntry {
  readonly requestKind?: string;
  readonly itemType?: string;
  readonly toolTitle?: string;
  readonly detail?: string;
}

/** Returns the workspace image path viewed by a supported read entry. */
export function workEntryViewedImagePath(entry: ViewedImageWorkEntry): string | null {
  const isReadEntry =
    entry.requestKind === "file-read" ||
    entry.itemType === "image_view" ||
    (entry.itemType === "dynamic_tool_call" &&
      entry.toolTitle?.trim().toLowerCase() === "read file");
  if (!isReadEntry) return null;

  const detail = entry.detail?.trim();
  if (!detail || detail.includes("\n") || !isWorkspaceImagePreviewPath(detail)) return null;
  return detail;
}
