import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";

export function folderDropTarget(input: {
  localEnvironmentDisabled: boolean;
  environmentId: EnvironmentId;
  primaryEnvironmentId: EnvironmentId | null;
}): "local" | "remote" {
  if (
    input.localEnvironmentDisabled ||
    input.primaryEnvironmentId === null ||
    input.environmentId !== input.primaryEnvironmentId
  ) {
    return "remote";
  }
  return "local";
}

/** Project-relative path of the one directory entry named like the dropped folder, or null when none/ambiguous. */
export function matchDroppedFolderEntry(
  folderName: string,
  entries: ReadonlyArray<ProjectEntry>,
): string | null {
  const matches = entries.filter(
    (entry) =>
      entry.kind === "directory" &&
      entry.path
        .replace(/[\\/]+$/, "")
        .split(/[\\/]/)
        .pop() === folderName,
  );
  return matches.length === 1 ? (matches[0]?.path ?? null) : null;
}
