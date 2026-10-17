// @effect-diagnostics-next-line nodeBuiltinImport:off - Effect's symlink has no type argument, and Windows needs a junction to link without elevation.
import * as NodeFSP from "node:fs/promises";

import { ProviderDriverKind, type CodexSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as PlatformError from "effect/PlatformError";

import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";

export interface CodexHomeLayout {
  readonly mode: "direct" | "authOverlay";
  readonly sharedHomePath: string;
  readonly effectiveHomePath: string | undefined;
  readonly continuationKey: string;
}

const KNOWN_SHARED_DIRECTORIES = [
  "sessions",
  "archived_sessions",
  "sqlite",
  "shell_snapshots",
  "worktrees",
  "skills",
  "plugins",
  "cache",
  "logs",
  "mcp-oauth-locks",
] as const;

const PRIVATE_ENTRY_NAMES = new Set(["auth.json", "models_cache.json"]);
const SHADOW_LOCAL_ENTRY_NAMES = new Set(["log", "memories", "tmp"]);
// Codex creates these runtime locks itself when it starts in a shadow home before the shared
// home has one. They guard shared state, so a local copy is replaced with the shared link.
const REPLACEABLE_SHARED_RUNTIME_ENTRIES = new Set(["mcp-oauth-locks", ".sqlite-maintenance.lock"]);
// Windows refuses symlinks without Developer Mode or the symlink privilege. A shadow home it refused
// links directories with junctions and keeps its own files: a junction cannot reach a file, and a
// hard link splits the first time Codex rewrites config.toml by rename. The marker keeps the home
// that way, since its local files would conflict if symlinks were allowed later.
const LOCAL_FILES_MARKER_NAME = ".t3-local-files";
// The user's own Codex setup, lowercased. Such a home gets a copy of each one it lacks on every
// refresh, so the account starts with the same configuration and instructions; later edits on either
// side stay separate.
const COPIED_LOCAL_FILE_NAMES = new Set([
  "config.toml",
  "agents.md",
  "agents.override.md",
  "hooks.json",
]);

function resolveHomePath(path: Path.Path, home: string, value: string | undefined): string {
  const expanded =
    value && value.trim().length > 0 ? expandHomePath(value, home) : path.join(home, ".codex");
  return path.resolve(expanded);
}

export const resolveCodexHomeLayout = Effect.fn("resolveCodexHomeLayout")(function* (
  config: CodexSettings,
): Effect.fn.Return<CodexHomeLayout, never, Path.Path> {
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const sharedHomePath = resolveHomePath(path, home, config.homePath);
  const shadowHomePath = config.shadowHomePath.trim();
  if (shadowHomePath.length === 0) {
    return {
      mode: "direct",
      sharedHomePath,
      effectiveHomePath: config.homePath.trim().length > 0 ? sharedHomePath : undefined,
      continuationKey: `codex:home:${sharedHomePath}`,
    };
  }

  const effectiveHomePath = path.resolve(expandHomePath(shadowHomePath, home));
  return {
    mode: "authOverlay",
    sharedHomePath,
    effectiveHomePath,
    continuationKey: `codex:home:${sharedHomePath}`,
  };
});

const CodexShadowHomeContext = {
  sharedHomePath: Schema.String,
  effectiveHomePath: Schema.String,
};

export class CodexShadowHomeFileSystemError extends Schema.TaggedError<CodexShadowHomeFileSystemError>()(
  "CodexShadowHomeFileSystemError",
  {
    ...CodexShadowHomeContext,
    operation: Schema.Literals([
      "readLink",
      "makeDirectory",
      "readDirectory",
      "remove",
      "symlink",
      "stat",
      "writeFile",
      "copyFile",
    ]),
    path: Schema.String,
    targetPath: Schema.optional(Schema.String),
    entryName: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const target = this.targetPath === undefined ? "" : ` to '${this.targetPath}'`;
    return `Codex shadow home filesystem operation '${this.operation}' failed for '${this.path}'${target}.`;
  }
}

export class CodexShadowHomePathConflictError extends Schema.TaggedError<CodexShadowHomePathConflictError>()(
  "CodexShadowHomePathConflictError",
  CodexShadowHomeContext,
) {
  override get message(): string {
    return `Codex shadow home path '${this.effectiveHomePath}' must be different from the shared home path '${this.sharedHomePath}'.`;
  }
}

export class CodexShadowHomeEntryConflictError extends Schema.TaggedError<CodexShadowHomeEntryConflictError>()(
  "CodexShadowHomeEntryConflictError",
  {
    ...CodexShadowHomeContext,
    entryName: Schema.String,
    linkPath: Schema.String,
    targetPath: Schema.String,
  },
) {
  override get message(): string {
    return `Cannot create Codex shadow home entry '${this.entryName}' because '${this.linkPath}' already exists and is not a symlink.`;
  }
}

export class CodexShadowHomePrivateEntrySymlinkError extends Schema.TaggedError<CodexShadowHomePrivateEntrySymlinkError>()(
  "CodexShadowHomePrivateEntrySymlinkError",
  {
    ...CodexShadowHomeContext,
    entryName: Schema.String,
    path: Schema.String,
  },
) {
  override get message(): string {
    return `Codex shadow home private entry '${this.entryName}' at '${this.path}' must be a real file, not a symlink.`;
  }
}

export const CodexShadowHomeError = Schema.Union([
  CodexShadowHomeFileSystemError,
  CodexShadowHomePathConflictError,
  CodexShadowHomeEntryConflictError,
  CodexShadowHomePrivateEntrySymlinkError,
]);
export type CodexShadowHomeError = typeof CodexShadowHomeError.Type;

type LinkState =
  | {
      readonly _tag: "Missing";
    }
  | {
      readonly _tag: "NotSymlink";
    }
  | {
      readonly _tag: "Symlink";
      readonly target: string;
    };

function hasErrorCode(error: PlatformError.PlatformError, code: string): boolean {
  const cause = error.reason.cause;
  return (
    error.reason._tag === "Unknown" &&
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === code
  );
}

const readLinkState = Effect.fn("CodexHomeLayout.readLinkState")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly sharedHomePath: string;
  readonly effectiveHomePath: string;
  readonly entryName: string;
  readonly linkPath: string;
}): Effect.fn.Return<LinkState, CodexShadowHomeError> {
  return yield* input.fileSystem.readLink(input.linkPath).pipe(
    Effect.map((target): LinkState => ({ _tag: "Symlink", target })),
    Effect.catchTags({
      PlatformError: (cause) => {
        if (cause.reason._tag === "NotFound") {
          return Effect.succeed<LinkState>({ _tag: "Missing" });
        }
        if (hasErrorCode(cause, "EINVAL")) {
          return Effect.succeed<LinkState>({ _tag: "NotSymlink" });
        }
        return new CodexShadowHomeFileSystemError({
          sharedHomePath: input.sharedHomePath,
          effectiveHomePath: input.effectiveHomePath,
          operation: "readLink",
          path: input.linkPath,
          entryName: input.entryName,
          cause,
        });
      },
    }),
  );
});

const removePrivateSymlink = Effect.fn("CodexHomeLayout.removePrivateSymlink")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly sharedHomePath: string;
  readonly effectiveHomePath: string;
  readonly entryName: string;
}): Effect.fn.Return<void, CodexShadowHomeError, Path.Path> {
  const path = yield* Path.Path;
  const privatePath = path.join(input.effectiveHomePath, input.entryName);
  const state = yield* readLinkState({
    ...input,
    linkPath: privatePath,
  });
  if (state._tag === "Symlink") {
    yield* input.fileSystem.remove(privatePath).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          new CodexShadowHomeFileSystemError({
            sharedHomePath: input.sharedHomePath,
            effectiveHomePath: input.effectiveHomePath,
            operation: "remove",
            path: privatePath,
            entryName: input.entryName,
            cause,
          }),
      }),
    );
  }
});

const ensureSymlink = Effect.fn("CodexHomeLayout.ensureSymlink")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly sharedHomePath: string;
  readonly effectiveHomePath: string;
  readonly entryName: string;
  readonly localFiles: Ref.Ref<boolean>;
}): Effect.fn.Return<void, CodexShadowHomeError, Path.Path> {
  const path = yield* Path.Path;
  const isWindows = yield* HostProcess.isWindows;
  const target = path.join(input.sharedHomePath, input.entryName);
  const link = path.join(input.effectiveHomePath, input.entryName);
  const state = yield* readLinkState({
    ...input,
    linkPath: link,
  });

  const fileSystemError =
    (operation: "stat" | "symlink" | "writeFile" | "copyFile", errorPath: string) =>
    (cause: unknown) =>
      new CodexShadowHomeFileSystemError({
        sharedHomePath: input.sharedHomePath,
        effectiveHomePath: input.effectiveHomePath,
        operation,
        path: errorPath,
        ...(operation === "symlink" ? { targetPath: target } : {}),
        entryName: input.entryName,
        cause,
      });
  // An entry that vanished after the shared home was listed has nothing for a junction to reach.
  const targetIsDirectory = input.fileSystem.stat(target).pipe(
    Effect.map((info) => info.type === "Directory"),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
    Effect.mapError(fileSystemError("stat", target)),
  );
  const linkWithoutSymlinks = Effect.gen(function* () {
    if (yield* targetIsDirectory) {
      return yield* Effect.tryPromise({
        try: () => NodeFSP.symlink(target, link, "junction"),
        catch: fileSystemError("symlink", link),
      });
    }
    // Only reached on Windows, whose file names ignore case.
    if (!COPIED_LOCAL_FILE_NAMES.has(input.entryName.toLowerCase())) return;
    // Written in full in a directory of its own beside the destination, then hard-linked into
    // place. An interrupted pass leaves no file, which the next refresh copies again, or a complete
    // one. The link never replaces a file Codex, the user or a concurrent refresh put there first.
    yield* input.fileSystem
      .makeTempDirectory({ directory: input.effectiveHomePath, prefix: ".t3-copy-" })
      .pipe(
        Effect.flatMap((copyDirectory) => {
          const copyPath = path.join(copyDirectory, input.entryName);
          return Effect.scoped(
            Effect.gen(function* () {
              const contents = yield* input.fileSystem.readFile(target);
              const copy = yield* input.fileSystem.open(copyPath, { flag: "wx" });
              yield* copy.writeAll(contents);
              yield* copy.sync;
            }),
          ).pipe(
            Effect.andThen(input.fileSystem.link(copyPath, link)),
            Effect.ensuring(
              input.fileSystem
                .remove(copyDirectory, { recursive: true, force: true })
                .pipe(Effect.ignore),
            ),
          );
        }),
        Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.void),
        Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
        Effect.mapError(fileSystemError("copyFile", link)),
      );
  });
  const markerPath = path.join(input.effectiveHomePath, LOCAL_FILES_MARKER_NAME);
  const keepFilesLocal = input.fileSystem.writeFileString(markerPath, "", { flag: "wx" }).pipe(
    Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.void),
    Effect.mapError(fileSystemError("writeFile", markerPath)),
    Effect.andThen(Ref.set(input.localFiles, true)),
  );

  const createLink = Effect.gen(function* () {
    if (yield* Ref.get(input.localFiles)) {
      return yield* linkWithoutSymlinks;
    }
    yield* input.fileSystem.symlink(target, link).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          // Marked first: a local file left by an interrupted pass must not read as a conflict.
          isWindows && hasErrorCode(cause, "EPERM")
            ? keepFilesLocal.pipe(Effect.andThen(linkWithoutSymlinks))
            : Effect.fail(fileSystemError("symlink", link)(cause)),
      }),
    );
  });

  if (state._tag === "NotSymlink") {
    // Checked before the replaceable entries: a local lock file could be deleted here, but no link
    // could take its place.
    if ((yield* Ref.get(input.localFiles)) && !(yield* targetIsDirectory)) {
      return;
    }
    if (!REPLACEABLE_SHARED_RUNTIME_ENTRIES.has(input.entryName)) {
      return yield* new CodexShadowHomeEntryConflictError({
        sharedHomePath: input.sharedHomePath,
        effectiveHomePath: input.effectiveHomePath,
        entryName: input.entryName,
        linkPath: link,
        targetPath: target,
      });
    }

    yield* input.fileSystem.remove(link, { recursive: true }).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          new CodexShadowHomeFileSystemError({
            sharedHomePath: input.sharedHomePath,
            effectiveHomePath: input.effectiveHomePath,
            operation: "remove",
            path: link,
            entryName: input.entryName,
            cause,
          }),
      }),
    );
    return yield* createLink;
  }

  if (state._tag === "Missing") {
    return yield* createLink;
  }

  const resolvedExisting = path.resolve(path.dirname(link), state.target);
  if (resolvedExisting !== target) {
    yield* input.fileSystem.remove(link).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          new CodexShadowHomeFileSystemError({
            sharedHomePath: input.sharedHomePath,
            effectiveHomePath: input.effectiveHomePath,
            operation: "remove",
            path: link,
            entryName: input.entryName,
            cause,
          }),
      }),
    );
    yield* createLink;
  }
});

const ensureShadowAuthIsPrivate = Effect.fn("CodexHomeLayout.ensureShadowAuthIsPrivate")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly sharedHomePath: string;
    readonly effectiveHomePath: string;
  }): Effect.fn.Return<void, CodexShadowHomeError, Path.Path> {
    const path = yield* Path.Path;
    const entryName = "auth.json";
    const authPath = path.join(input.effectiveHomePath, entryName);
    const state = yield* readLinkState({
      ...input,
      entryName,
      linkPath: authPath,
    });
    if (state._tag === "Symlink") {
      return yield* new CodexShadowHomePrivateEntrySymlinkError({
        sharedHomePath: input.sharedHomePath,
        effectiveHomePath: input.effectiveHomePath,
        entryName,
        path: authPath,
      });
    }
  },
);

export const materializeCodexShadowHome = Effect.fn("materializeCodexShadowHome")(function* (
  layout: CodexHomeLayout,
) {
  if (layout.mode !== "authOverlay") return;
  const effectiveHomePath = layout.effectiveHomePath;
  if (!effectiveHomePath) return;
  if (layout.sharedHomePath === effectiveHomePath) {
    return yield* new CodexShadowHomePathConflictError({
      sharedHomePath: layout.sharedHomePath,
      effectiveHomePath,
    });
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const makeDirectory = (directoryPath: string) =>
    fileSystem.makeDirectory(directoryPath, { recursive: true }).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          new CodexShadowHomeFileSystemError({
            sharedHomePath: layout.sharedHomePath,
            effectiveHomePath,
            operation: "makeDirectory",
            path: directoryPath,
            cause,
          }),
      }),
    );

  yield* Effect.all(
    [
      makeDirectory(layout.sharedHomePath),
      makeDirectory(effectiveHomePath),
      ...KNOWN_SHARED_DIRECTORIES.map((directory) =>
        makeDirectory(path.join(layout.sharedHomePath, directory)),
      ),
    ],
    { concurrency: "unbounded" },
  );

  const sharedEntryNames = yield* fileSystem.readDirectory(layout.sharedHomePath).pipe(
    Effect.catchTags({
      PlatformError: (cause) =>
        new CodexShadowHomeFileSystemError({
          sharedHomePath: layout.sharedHomePath,
          effectiveHomePath,
          operation: "readDirectory",
          path: layout.sharedHomePath,
          cause,
        }),
    }),
  );
  const entries = new Set<string>(KNOWN_SHARED_DIRECTORIES);
  for (const entryName of sharedEntryNames) {
    if (!PRIVATE_ENTRY_NAMES.has(entryName) && !SHADOW_LOCAL_ENTRY_NAMES.has(entryName)) {
      entries.add(entryName);
    }
  }

  yield* Effect.forEach(
    PRIVATE_ENTRY_NAMES,
    (entryName) =>
      entryName === "auth.json"
        ? Effect.void
        : removePrivateSymlink({
            fileSystem,
            sharedHomePath: layout.sharedHomePath,
            effectiveHomePath,
            entryName,
          }),
    { discard: true },
  );

  const localFiles = yield* Ref.make(
    (yield* HostProcess.isWindows) &&
      (yield* readLinkState({
        fileSystem,
        sharedHomePath: layout.sharedHomePath,
        effectiveHomePath,
        entryName: LOCAL_FILES_MARKER_NAME,
        linkPath: path.join(effectiveHomePath, LOCAL_FILES_MARKER_NAME),
      }))._tag !== "Missing",
  );

  yield* Effect.forEach(
    entries,
    (entryName) => {
      if (PRIVATE_ENTRY_NAMES.has(entryName)) {
        return Effect.void;
      }
      return ensureSymlink({
        fileSystem,
        sharedHomePath: layout.sharedHomePath,
        effectiveHomePath,
        entryName,
        localFiles,
      });
    },
    { discard: true },
  );

  yield* ensureShadowAuthIsPrivate({
    fileSystem,
    sharedHomePath: layout.sharedHomePath,
    effectiveHomePath,
  });
});

export function codexContinuationIdentity(layout: CodexHomeLayout) {
  return {
    driverKind: ProviderDriverKind.make("codex"),
    continuationKey: layout.continuationKey,
  };
}
