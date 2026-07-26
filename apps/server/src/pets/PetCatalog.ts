import {
  CodexSettings,
  type PetAnimation,
  type PetCatalogEntry,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { issueTrustedFileUrl } from "../assets/AssetAccess.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";

const FRAME_WIDTH = 192;
const FRAME_HEIGHT = 208;
const COLUMNS = 8;
const ROWS = 9;
const MAX_SPRITESHEET_BYTES = 4 * 1024 * 1024;
const PET_CDN = "https://persistent.oaistatic.com/codex/pets/v1";

const BUILTIN_PETS = [
  ["codex", "Codex", "The original Codex companion", "codex-spritesheet-v4.webp"],
  ["dewey", "Dewey", "A tidy duck for calm workspace days", "dewey-spritesheet-v4.webp"],
  ["fireball", "Fireball", "Hot path energy for fast iteration", "fireball-spritesheet-v4.webp"],
  ["rocky", "Rocky", "A steady rock when the diff gets large", "rocky-spritesheet-v4.webp"],
  ["seedy", "Seedy", "Small green shoots for new ideas", "seedy-spritesheet-v4.webp"],
  ["stacky", "Stacky", "A balanced stack for deep work", "stacky-spritesheet-v4.webp"],
  ["bsod", "BSOD", "A tiny blue-screen gremlin", "bsod-spritesheet-v4.webp"],
  ["null-signal", "Null Signal", "Quiet signal from the void", "null-signal-spritesheet-v4.webp"],
] as const;

type ManifestAnimation = {
  readonly frames?: unknown;
  readonly fps?: unknown;
  readonly loop?: unknown;
  readonly fallback?: unknown;
};

const decodeCodexSettings = Schema.decodeOption(CodexSettings);
const PetManifestSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  displayName: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  spritesheetPath: Schema.optionalKey(Schema.String),
  animations: Schema.optionalKey(Schema.Unknown),
});
const decodePetManifest = Schema.decodeOption(Schema.fromJsonString(PetManifestSchema));

function appAnimation(
  row: number,
  frameCount: number,
  frameDurationMs: number,
  finalFrameDurationMs: number,
): PetAnimation {
  return {
    frames: Array.from({ length: frameCount }, (_, column) => ({
      spriteIndex: row * COLUMNS + column,
      durationMs: column === frameCount - 1 ? finalFrameDurationMs : frameDurationMs,
    })),
    loopStart: 0,
    fallback: "idle",
  };
}

export function defaultPetAnimations(): Record<string, PetAnimation> {
  const idle: PetAnimation = {
    frames: [
      [0, 1680],
      [1, 660],
      [2, 660],
      [3, 840],
      [4, 840],
      [5, 1920],
    ].map(([spriteIndex, durationMs]) => ({ spriteIndex: spriteIndex!, durationMs: durationMs! })),
    loopStart: 0,
    fallback: "idle",
  };
  return {
    idle,
    "running-right": appAnimation(1, 8, 120, 220),
    "running-left": appAnimation(2, 8, 120, 220),
    waving: appAnimation(3, 4, 140, 280),
    jumping: appAnimation(4, 5, 140, 280),
    failed: appAnimation(5, 8, 140, 240),
    waiting: appAnimation(6, 6, 150, 260),
    running: appAnimation(7, 6, 120, 220),
    review: appAnimation(8, 6, 150, 280),
  };
}

function normalizeAnimations(value: unknown): Record<string, PetAnimation> {
  const animations = defaultPetAnimations();
  if (!value || typeof value !== "object" || Array.isArray(value)) return animations;

  for (const [name, raw] of Object.entries(value)) {
    const spec = raw as ManifestAnimation;
    if (!Array.isArray(spec.frames) || spec.frames.length === 0) continue;
    const indices = spec.frames.filter(
      (frame): frame is number =>
        Number.isInteger(frame) && Number(frame) >= 0 && Number(frame) < COLUMNS * ROWS,
    );
    if (indices.length !== spec.frames.length) continue;
    const fps =
      typeof spec.fps === "number" && Number.isFinite(spec.fps) && spec.fps > 0 && spec.fps <= 60
        ? spec.fps
        : 8;
    const fallback =
      typeof spec.fallback === "string" && spec.fallback.trim() ? spec.fallback.trim() : "idle";
    animations[name] = {
      frames: indices.map((spriteIndex) => ({
        spriteIndex,
        durationMs: Math.max(1, Math.round(1000 / fps)),
      })),
      loopStart: spec.loop === false ? null : 0,
      fallback,
    };
  }
  return Object.fromEntries(
    Object.entries(animations).map(([name, animation]) => [
      name,
      animations[animation.fallback] ? animation : { ...animation, fallback: "idle" },
    ]),
  );
}

function builtinEntries(): PetCatalogEntry[] {
  const animations = defaultPetAnimations();
  return BUILTIN_PETS.map(([id, displayName, description, file]) => ({
    id: `builtin:${id}`,
    displayName,
    description,
    source: "builtin",
    spritesheetUrl: `${PET_CDN}/${file}`,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    columns: COLUMNS,
    rows: ROWS,
    animations,
  }));
}

function codexHomes(
  settings: ServerSettings,
): Array<{ instanceId: string; settings: CodexSettings }> {
  const candidates: Array<{ instanceId: string; settings: CodexSettings }> = [];
  for (const [instanceId, instance] of Object.entries(settings.providerInstances)) {
    if (instance.driver !== "codex") continue;
    const decoded = decodeCodexSettings(instance.config ?? {});
    if (decoded._tag === "Some") candidates.push({ instanceId, settings: decoded.value });
  }
  if (!candidates.some(({ instanceId }) => instanceId === "codex")) {
    candidates.push({ instanceId: "codex", settings: settings.providers.codex });
  }

  return candidates;
}

const loadCustomPet = Effect.fn("PetCatalog.loadCustomPet")(function* (input: {
  readonly instanceId: string;
  readonly homePath: string;
  readonly directoryName: "pets" | "avatars";
  readonly folderName: string;
}): Effect.fn.Return<
  PetCatalogEntry | null,
  never,
  FileSystem.FileSystem | Path.Path | ServerSecretStore.ServerSecretStore
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(input.homePath);
  const petDir = path.join(root, input.directoryName, input.folderName);
  const manifestName = input.directoryName === "pets" ? "pet.json" : "avatar.json";
  const manifestPath = path.join(petDir, manifestName);

  return yield* Effect.gen(function* () {
    const raw = yield* fileSystem.readFileString(manifestPath);
    const decodedManifest = decodePetManifest(raw);
    if (decodedManifest._tag === "None") return null;
    const manifest = decodedManifest.value;
    const spriteName =
      typeof manifest.spritesheetPath === "string" && manifest.spritesheetPath.trim()
        ? manifest.spritesheetPath.trim()
        : "spritesheet.webp";
    if (path.isAbsolute(spriteName) || spriteName.split(/[\\/]/).includes("..")) return null;
    const spritesheetPath = path.resolve(petDir, spriteName);
    const relative = path.relative(petDir, spritesheetPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    const extension = path.extname(spritesheetPath).toLowerCase();
    if (extension !== ".webp" && extension !== ".png") return null;
    const info = yield* fileSystem.stat(spritesheetPath);
    if (info.type !== "File" || Number(info.size) > MAX_SPRITESHEET_BYTES) return null;
    const signed = yield* issueTrustedFileUrl(spritesheetPath);
    if (!signed) return null;
    const displayName =
      typeof manifest.displayName === "string" && manifest.displayName.trim()
        ? manifest.displayName.trim()
        : typeof manifest.id === "string" && manifest.id.trim()
          ? manifest.id.trim()
          : input.folderName;
    return {
      id: `custom:${input.instanceId}:${input.folderName}`,
      displayName,
      description:
        typeof manifest.description === "string" ? manifest.description.trim() : "Custom pet",
      source: "custom" as const,
      spritesheetUrl: signed.relativeUrl,
      frameWidth: FRAME_WIDTH,
      frameHeight: FRAME_HEIGHT,
      columns: COLUMNS,
      rows: ROWS,
      animations: normalizeAnimations(manifest.animations),
    };
  }).pipe(Effect.orElseSucceed(() => null));
});

export const listPets = Effect.fn("PetCatalog.listPets")(function* (
  settings: ServerSettings,
): Effect.fn.Return<
  { readonly pets: ReadonlyArray<PetCatalogEntry> },
  never,
  FileSystem.FileSystem | Path.Path | ServerSecretStore.ServerSecretStore
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const custom: PetCatalogEntry[] = [];
  const seenHomes = new Set<string>();

  for (const candidate of codexHomes(settings)) {
    const homePath = (yield* resolveCodexHomeLayout(candidate.settings)).sharedHomePath;
    const canonicalHome = yield* fileSystem
      .realPath(homePath)
      .pipe(Effect.orElseSucceed(() => path.resolve(homePath)));
    if (seenHomes.has(canonicalHome)) continue;
    seenHomes.add(canonicalHome);

    for (const directoryName of ["pets", "avatars"] as const) {
      const names = yield* fileSystem
        .readDirectory(path.join(canonicalHome, directoryName))
        .pipe(Effect.orElseSucceed(() => []));
      for (const folderName of names) {
        const pet = yield* loadCustomPet({
          instanceId: candidate.instanceId,
          homePath: canonicalHome,
          directoryName,
          folderName,
        });
        if (pet && !custom.some((entry) => entry.id === pet.id)) custom.push(pet);
      }
    }
  }

  return {
    pets: [
      ...builtinEntries(),
      ...custom.toSorted((a, b) => a.displayName.localeCompare(b.displayName)),
    ],
  };
});
