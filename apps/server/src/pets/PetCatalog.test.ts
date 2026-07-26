import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { defaultPetAnimations, listPets } from "./PetCatalog.ts";

const configLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-pet-catalog-test-",
});
const testLayer = Layer.mergeAll(
  configLayer,
  ServerSecretStore.layer.pipe(Layer.provide(configLayer)),
).pipe(Layer.provideMerge(NodeServices.layer));

describe("PetCatalog", () => {
  it("uses the complete Codex atlas state vocabulary", () => {
    expect(Object.keys(defaultPetAnimations())).toEqual([
      "idle",
      "running-right",
      "running-left",
      "waving",
      "jumping",
      "failed",
      "waiting",
      "running",
      "review",
    ]);
  });

  it.effect("lists built-ins and custom pets from each configured Codex home", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homePath = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-custom-pet-home-",
      });
      const petDir = path.join(homePath, "pets", "helper");
      yield* fileSystem.makeDirectory(petDir, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(petDir, "pet.json"),
        `{
          "id": "helper",
          "displayName": "Helper",
          "description": "A custom test companion",
          "spritesheetPath": "spritesheet.webp"
        }`,
      );
      yield* fileSystem.writeFile(path.join(petDir, "spritesheet.webp"), new Uint8Array([1]));

      const instanceId = ProviderInstanceId.make("codex_work");
      const result = yield* listPets({
        ...DEFAULT_SERVER_SETTINGS,
        providerInstances: {
          [instanceId]: {
            driver: ProviderDriverKind.make("codex"),
            config: { homePath },
          },
        },
      });

      expect(result.pets.filter((pet) => pet.source === "builtin")).toHaveLength(8);
      expect(result.pets.find((pet) => pet.id === "custom:codex_work:helper")).toMatchObject({
        displayName: "Helper",
        description: "A custom test companion",
        source: "custom",
      });
      expect(
        result.pets.find((pet) => pet.id === "custom:codex_work:helper")?.spritesheetUrl,
      ).toMatch(/^\/api\/assets\//);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );
});
