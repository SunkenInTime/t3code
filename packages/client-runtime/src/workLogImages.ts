import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";

export interface ViewedImageWorkEntry {
  readonly requestKind?: string;
  readonly itemType?: string;
  readonly toolTitle?: string;
  readonly detail?: string;
}

/** Whether a work entry represents a supported file read or image view. */
export function workEntryIsRead(entry: ViewedImageWorkEntry): boolean {
  return (
    entry.requestKind === "file-read" ||
    entry.itemType === "image_view" ||
    (entry.itemType === "dynamic_tool_call" &&
      entry.toolTitle?.trim().toLowerCase() === "read file")
  );
}

/** Returns the workspace image path viewed by a supported read entry. */
export function workEntryViewedImagePath(entry: ViewedImageWorkEntry): string | null {
  if (!workEntryIsRead(entry)) return null;

  const detail = entry.detail?.trim();
  if (!detail || /[\r\n]/.test(detail) || !isWorkspaceImagePreviewPath(detail)) return null;
  return detail;
}
