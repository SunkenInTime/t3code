import { describe, expect, it } from "vite-plus/test";

import { editorLabelForPlatform, openInEditorMenuLabel } from "./editorLabels";

describe("editorLabelForPlatform", () => {
  it("uses the editor name from the shared editor definitions", () => {
    expect(editorLabelForPlatform("cursor", "MacIntel")).toBe("Cursor");
    expect(editorLabelForPlatform("vscode-insiders", "Win32")).toBe("VS Code Insiders");
  });

  it.each([
    ["MacIntel", "Finder"],
    ["Win32", "Explorer"],
    ["Linux x86_64", "Files"],
  ])("uses the platform file-manager name on %s", (platform, label) => {
    expect(editorLabelForPlatform("file-manager", platform)).toBe(label);
  });
});

describe("openInEditorMenuLabel", () => {
  it("names the preferred editor", () => {
    expect(openInEditorMenuLabel("zed", { os: "linux", fileManagerKind: undefined })).toBe(
      "Open in Zed",
    );
  });

  it("uses the environment OS for its file manager", () => {
    expect(openInEditorMenuLabel("file-manager", { os: "linux", fileManagerKind: undefined })).toBe(
      "Open in Files",
    );
  });

  it("uses the server-selected file manager kind for WSL", () => {
    expect(
      openInEditorMenuLabel("file-manager", {
        os: "linux",
        fileManagerKind: "file-explorer",
      }),
    ).toBe("Open in Explorer");
  });

  it("keeps the generic fallback when no environment config is available", () => {
    expect(openInEditorMenuLabel("file-manager", null)).toBe("Open in editor");
    expect(openInEditorMenuLabel(null, null)).toBe("Open in editor");
  });
});
