import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { folderDropTarget } from "./folderDrop";

const environmentId = EnvironmentId.make("environment-1");

describe("folderDropTarget", () => {
  it("targets the local environment in Electron", () => {
    expect(
      folderDropTarget({
        isElectron: true,
        localEnvironmentDisabled: false,
        environmentId,
        primaryEnvironmentId: environmentId,
      }),
    ).toBe("local");
  });

  it("targets remote when Electron has no local environment", () => {
    expect(
      folderDropTarget({
        isElectron: true,
        localEnvironmentDisabled: true,
        environmentId,
        primaryEnvironmentId: environmentId,
      }),
    ).toBe("remote");
  });

  it("targets browser outside Electron", () => {
    expect(
      folderDropTarget({
        isElectron: false,
        localEnvironmentDisabled: false,
        environmentId,
        primaryEnvironmentId: environmentId,
      }),
    ).toBe("browser");
  });
});
