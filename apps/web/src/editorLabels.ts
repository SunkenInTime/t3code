import {
  EDITORS,
  type EditorId,
  type ExecutionEnvironmentPlatformOs,
  type FileManagerRevealKind,
} from "@t3tools/contracts";

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

type EditorEnvironmentLabelContext = {
  readonly os: ExecutionEnvironmentPlatformOs;
  readonly fileManagerKind: FileManagerRevealKind | undefined;
};

function editorLabelForEnvironment(
  editorId: EditorId,
  environment: EditorEnvironmentLabelContext,
): string {
  if (editorId !== "file-manager") return editorLabels.get(editorId) ?? "Editor";
  if (environment.fileManagerKind === "finder") return "Finder";
  if (environment.fileManagerKind === "file-explorer") return "Explorer";
  if (environment.fileManagerKind === "files") return "Files";
  if (environment.os === "darwin") return "Finder";
  if (environment.os === "windows") return "Explorer";
  return "Files";
}

export function openInEditorMenuLabel(
  editorId: EditorId | null,
  environment: EditorEnvironmentLabelContext | null,
): string {
  return editorId === null || environment === null
    ? "Open in editor"
    : `Open in ${editorLabelForEnvironment(editorId, environment)}`;
}
