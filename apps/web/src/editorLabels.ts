import { EDITORS, type EditorId } from "@t3tools/contracts";

import { isMacPlatform, isWindowsPlatform } from "~/lib/utils";

const editorLabels = new Map<EditorId, string>(EDITORS.map((editor) => [editor.id, editor.label]));

export function editorLabelForPlatform(editorId: EditorId, platform: string): string {
  if (editorId === "file-manager") {
    if (isMacPlatform(platform)) return "Finder";
    if (isWindowsPlatform(platform)) return "Explorer";
    return "Files";
  }

  return editorLabels.get(editorId) ?? "Editor";
}

export function openInEditorMenuLabel(editorId: EditorId | null, platform: string): string {
  return editorId === null
    ? "Open in editor"
    : `Open in ${editorLabelForPlatform(editorId, platform)}`;
}
