import { resolveMediaSource } from "@t3tools/client-runtime/media-source";
import { getBrowseDirectoryPath } from "@t3tools/client-runtime/state/projects";
import type { ThreadId } from "@t3tools/contracts";

import { resolveWorkspaceFilePath } from "./filePath";

export function resolveFileMarkdownImage(input: {
  readonly cwd: string;
  readonly relativePath: string;
  readonly href: string;
  readonly threadId: ThreadId;
}) {
  const markdownPath = resolveWorkspaceFilePath(input.cwd, input.relativePath);
  return resolveMediaSource(input.href, {
    threadId: input.threadId,
    workspaceRoot: getBrowseDirectoryPath(markdownPath),
    imageEmbed: true,
  });
}
