import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, type ProjectEntry } from "@t3tools/contracts";
import { folderDropTarget, matchDroppedFolderEntry } from "./folderDrop";

const environmentId = EnvironmentId.make("environment-1");

describe("folderDropTarget", () => {
  it("targets local when the thread is on the primary environment", () => {
    expect(
      folderDropTarget({
        localEnvironmentDisabled: false,
        environmentId,
        primaryEnvironmentId: environmentId,
      }),
    ).toBe("local");
  });

  it("targets remote when Electron has no local environment", () => {
    expect(
      folderDropTarget({
        localEnvironmentDisabled: true,
        environmentId,
        primaryEnvironmentId: environmentId,
      }),
    ).toBe("remote");
  });

  it("targets remote when the thread lives on another environment", () => {
    expect(
      folderDropTarget({
        localEnvironmentDisabled: false,
        environmentId: EnvironmentId.make("environment-2"),
        primaryEnvironmentId: environmentId,
      }),
    ).toBe("remote");
  });

  it("targets remote when no primary environment is known", () => {
    expect(
      folderDropTarget({
        localEnvironmentDisabled: false,
        environmentId,
        primaryEnvironmentId: null,
      }),
    ).toBe("remote");
  });
});

describe("matchDroppedFolderEntry", () => {
  it("returns the path for a unique directory match", () => {
    const entries: ReadonlyArray<ProjectEntry> = [
      { path: "packages/contracts", kind: "directory" },
      { path: "src/contracts.ts", kind: "file" },
    ];
    expect(matchDroppedFolderEntry("contracts", entries)).toBe("packages/contracts");
  });

  it("returns null when there is no match", () => {
    const entries: ReadonlyArray<ProjectEntry> = [{ path: "packages/shared", kind: "directory" }];
    expect(matchDroppedFolderEntry("contracts", entries)).toBeNull();
  });

  it("returns null when directory matches are ambiguous", () => {
    const entries: ReadonlyArray<ProjectEntry> = [
      { path: "packages/contracts", kind: "directory" },
      { path: "vendor/contracts", kind: "directory" },
    ];
    expect(matchDroppedFolderEntry("contracts", entries)).toBeNull();
  });

  it("ignores files with the matching name", () => {
    const entries: ReadonlyArray<ProjectEntry> = [{ path: "src/contracts", kind: "file" }];
    expect(matchDroppedFolderEntry("contracts", entries)).toBeNull();
  });
});
