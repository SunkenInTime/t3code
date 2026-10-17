import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import { CodexSettings } from "@t3tools/contracts";
import {
  CodexShadowHomeEntryConflictError,
  CodexShadowHomePathConflictError,
  materializeCodexShadowHome,
  resolveCodexHomeLayout,
} from "./CodexHomeLayout.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
const decodeCodexSettingsValue = Schema.decodeSync(CodexSettings);

const decodeCodexSettings = (input: {
  readonly enabled?: boolean;
  readonly homePath?: string;
  readonly shadowHomePath?: string;
  readonly customModels?: readonly string[];
  readonly binaryPath?: string;
}): CodexSettings => decodeCodexSettingsValue(input);

const makeTempDir = Effect.fn("CodexHomeLayout.test.makeTempDir")(function* (prefix: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix });
});

const writeTextFile = Effect.fn("CodexHomeLayout.test.writeTextFile")(function* (
  filePath: string,
  contents: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
  yield* fileSystem.writeFileString(filePath, contents);
});

// Windows without Developer Mode or elevation fails every symlink this way. Junctions still work.
const refuseSymlinksLikeWindows = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* effect.pipe(
      Effect.provideService(
        FileSystem.FileSystem,
        FileSystem.FileSystem.of({
          ...fileSystem,
          symlink: (target, link) =>
            Effect.fail(
              PlatformError.systemError({
                _tag: "Unknown",
                module: "FileSystem",
                method: "symlink",
                pathOrDescriptor: target,
                syscall: "symlink",
                cause: Object.assign(
                  new Error(`EPERM: operation not permitted, symlink '${target}' -> '${link}'`),
                  { errno: -4048, code: "EPERM", syscall: "symlink" },
                ),
              }),
            ),
        }),
      ),
      Effect.provideService(HostProcess.Platform, "win32"),
    );
  });

// A full disk or a killed process mid-write: half the bytes land, then the write fails.
const interruptWritesTo =
  (fileName: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const ioError = (filePath: string) =>
        PlatformError.systemError({
          _tag: "Unknown",
          module: "FileSystem",
          method: "write",
          pathOrDescriptor: filePath,
          syscall: "write",
          cause: Object.assign(new Error("EIO: i/o error, write"), { code: "EIO" }),
        });
      const half = (data: Uint8Array) => data.subarray(0, Math.floor(data.length / 2));
      const targets = (filePath: string) => filePath.endsWith(fileName);
      return yield* effect.pipe(
        Effect.provideService(
          FileSystem.FileSystem,
          FileSystem.FileSystem.of({
            ...fileSystem,
            writeFile: (filePath, data, options) =>
              targets(filePath)
                ? fileSystem
                    .writeFile(filePath, half(data), options)
                    .pipe(Effect.andThen(Effect.fail(ioError(filePath))))
                : fileSystem.writeFile(filePath, data, options),
            open: (filePath, options) =>
              fileSystem.open(filePath, options).pipe(
                Effect.map((file) =>
                  targets(filePath)
                    ? Object.assign(Object.create(file) as FileSystem.File, {
                        writeAll: (data: Uint8Array) =>
                          file
                            .writeAll(half(data))
                            .pipe(Effect.andThen(Effect.fail(ioError(filePath)))),
                      })
                    : file,
                ),
              ),
          }),
        ),
      );
    });

it.layer(NodeServices.layer)("CodexHomeLayout", (it) => {
  describe("resolveCodexHomeLayout", () => {
    it.effect("uses direct CODEX_HOME when no shadow home is configured", () =>
      Effect.gen(function* () {
        const homePath = yield* makeTempDir("t3code-codex-home-");

        const layout = yield* resolveCodexHomeLayout(
          decodeCodexSettings({
            homePath,
          }),
        );

        expect(layout).toMatchObject({
          mode: "direct",
          sharedHomePath: homePath,
          effectiveHomePath: homePath,
          continuationKey: `codex:home:${homePath}`,
        });
      }),
    );

    it.effect("uses the shared home for continuation and the shadow home for runtime", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sharedHome = yield* makeTempDir("t3code-codex-shared-");
        const shadowRoot = yield* makeTempDir("t3code-codex-shadow-root-");
        const shadowHome = path.join(shadowRoot, "shadow");

        const layout = yield* resolveCodexHomeLayout(
          decodeCodexSettings({
            homePath: sharedHome,
            shadowHomePath: shadowHome,
          }),
        );

        expect(layout).toMatchObject({
          mode: "authOverlay",
          sharedHomePath: sharedHome,
          effectiveHomePath: shadowHome,
          continuationKey: `codex:home:${sharedHome}`,
        });
      }),
    );
  });

  describe("materializeCodexShadowHome", () => {
    it.effect.skipIf(!symlinksSupported)(
      "materializes a shadow home with shared state links and private auth",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sharedHome = yield* makeTempDir("t3code-codex-shared-");
          const shadowRoot = yield* makeTempDir("t3code-codex-shadow-root-");
          const shadowHome = path.join(shadowRoot, "shadow");

          yield* fileSystem.makeDirectory(path.join(sharedHome, "sessions"));
          yield* writeTextFile(path.join(sharedHome, "config.toml"), 'model = "gpt-5-codex"\n');
          yield* writeTextFile(
            path.join(sharedHome, "models_cache.json"),
            '{"models":["shared"]}\n',
          );
          yield* writeTextFile(path.join(sharedHome, "auth.json"), '{"shared":true}\n');
          yield* fileSystem.makeDirectory(shadowHome, { recursive: true });
          yield* writeTextFile(path.join(shadowHome, "auth.json"), '{"shadow":true}\n');
          yield* fileSystem.symlink(
            path.join(sharedHome, "models_cache.json"),
            path.join(shadowHome, "models_cache.json"),
          );

          const layout = yield* resolveCodexHomeLayout(
            decodeCodexSettings({
              homePath: sharedHome,
              shadowHomePath: shadowHome,
            }),
          );

          yield* materializeCodexShadowHome(layout);

          const sessionsTarget = yield* fileSystem.readLink(path.join(shadowHome, "sessions"));
          const configTarget = yield* fileSystem.readLink(path.join(shadowHome, "config.toml"));
          const mcpOauthLocksTarget = yield* fileSystem.readLink(
            path.join(shadowHome, "mcp-oauth-locks"),
          );
          const modelsCacheExists = yield* fileSystem.exists(
            path.join(shadowHome, "models_cache.json"),
          );
          const authLinkResult = yield* fileSystem
            .readLink(path.join(shadowHome, "auth.json"))
            .pipe(Effect.result);
          const authContents = yield* fileSystem.readFileString(path.join(shadowHome, "auth.json"));

          expect(sessionsTarget).toBe(path.join(sharedHome, "sessions"));
          expect(configTarget).toBe(path.join(sharedHome, "config.toml"));
          expect(mcpOauthLocksTarget).toBe(path.join(sharedHome, "mcp-oauth-locks"));
          expect(modelsCacheExists).toBe(false);
          expect(authLinkResult._tag).toBe("Failure");
          expect(authContents).toContain("shadow");
        }),
    );

    it.effect.skipIf(!symlinksSupported)(
      "replaces a Codex-created local sqlite maintenance lock with the shared lock",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sharedHome = yield* makeTempDir("t3code-codex-shared-");
          const shadowRoot = yield* makeTempDir("t3code-codex-shadow-root-");
          const shadowHome = path.join(shadowRoot, "shadow");
          const sharedLock = path.join(sharedHome, ".sqlite-maintenance.lock");
          const shadowLock = path.join(shadowHome, ".sqlite-maintenance.lock");

          yield* writeTextFile(sharedLock, "");
          yield* writeTextFile(shadowLock, "");

          const layout = yield* resolveCodexHomeLayout(
            decodeCodexSettings({
              homePath: sharedHome,
              shadowHomePath: shadowHome,
            }),
          );

          yield* materializeCodexShadowHome(layout);

          expect(yield* fileSystem.readLink(shadowLock)).toBe(sharedLock);
        }),
    );

    it.effect.skipIf(!symlinksSupported)(
      "replaces Codex-created local MCP OAuth locks with the shared lock directory",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sharedHome = yield* makeTempDir("t3code-codex-shared-");
          const shadowRoot = yield* makeTempDir("t3code-codex-shadow-root-");
          const shadowHome = path.join(shadowRoot, "shadow");
          const sharedLocks = path.join(sharedHome, "mcp-oauth-locks");
          const shadowLocks = path.join(shadowHome, "mcp-oauth-locks");

          yield* writeTextFile(path.join(sharedLocks, "file-store.lock"), "");
          yield* writeTextFile(path.join(shadowLocks, "file-store.lock"), "");

          const layout = yield* resolveCodexHomeLayout(
            decodeCodexSettings({
              homePath: sharedHome,
              shadowHomePath: shadowHome,
            }),
          );

          yield* materializeCodexShadowHome(layout);

          const locksTarget = yield* fileSystem.readLink(shadowLocks);
          const sharedLockExists = yield* fileSystem.exists(
            path.join(sharedLocks, "file-store.lock"),
          );

          expect(locksTarget).toBe(sharedLocks);
          expect(sharedLockExists).toBe(true);
        }),
    );

    it.effect.skipIf(!symlinksSupported)(
      "accepts Codex-created shadow-local runtime directories",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sharedHome = yield* makeTempDir("t3code-codex-shared-");
          const shadowRoot = yield* makeTempDir("t3code-codex-shadow-root-");
          const shadowHome = path.join(shadowRoot, "shadow");

          yield* fileSystem.makeDirectory(path.join(sharedHome, "log"));
          yield* fileSystem.makeDirectory(path.join(sharedHome, "memories"));
          yield* fileSystem.makeDirectory(path.join(sharedHome, "tmp"));
          yield* writeTextFile(path.join(sharedHome, "config.toml"), 'model = "gpt-5-codex"\n');
          yield* writeTextFile(path.join(shadowHome, "auth.json"), '{"shadow":true}\n');
          yield* fileSystem.makeDirectory(path.join(shadowHome, "log"), { recursive: true });
          yield* fileSystem.makeDirectory(path.join(shadowHome, "memories"), { recursive: true });
          yield* fileSystem.makeDirectory(path.join(shadowHome, "tmp"), { recursive: true });

          const layout = yield* resolveCodexHomeLayout(
            decodeCodexSettings({
              homePath: sharedHome,
              shadowHomePath: shadowHome,
            }),
          );

          yield* materializeCodexShadowHome(layout);

          const configTarget = yield* fileSystem.readLink(path.join(shadowHome, "config.toml"));
          const logLinkResult = yield* fileSystem
            .readLink(path.join(shadowHome, "log"))
            .pipe(Effect.result);
          const memoriesLinkResult = yield* fileSystem
            .readLink(path.join(shadowHome, "memories"))
            .pipe(Effect.result);
          const tmpLinkResult = yield* fileSystem
            .readLink(path.join(shadowHome, "tmp"))
            .pipe(Effect.result);

          expect(configTarget).toBe(path.join(sharedHome, "config.toml"));
          expect(logLinkResult._tag).toBe("Failure");
          expect(memoriesLinkResult._tag).toBe("Failure");
          expect(tmpLinkResult._tag).toBe("Failure");
        }),
    );

    it.effect(
      "links directories with junctions and starts from a copy of the user's setup when Windows refuses symlinks",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sharedHome = yield* makeTempDir("t3code-codex-shared-");
          const shadowRoot = yield* makeTempDir("t3code-codex-shadow-root-");
          const shadowHome = path.join(shadowRoot, "shadow");
          yield* writeTextFile(path.join(sharedHome, "config.toml"), 'model = "gpt-5-codex"\n');
          yield* writeTextFile(path.join(sharedHome, "AGENTS.md"), "shared instructions\n");
          yield* writeTextFile(path.join(sharedHome, "history.jsonl"), "{}\n");
          yield* writeTextFile(path.join(sharedHome, "state_5.sqlite"), "shared-db");
          yield* writeTextFile(path.join(sharedHome, ".sqlite-maintenance.lock"), "");
          yield* writeTextFile(path.join(shadowHome, "auth.json"), '{"shadow":true}\n');
          const layout = yield* resolveCodexHomeLayout(
            decodeCodexSettings({ homePath: sharedHome, shadowHomePath: shadowHome }),
          );

          yield* materializeCodexShadowHome(layout).pipe(refuseSymlinksLikeWindows);
          const configAfterFirstPass = yield* fileSystem.readFileString(
            path.join(shadowHome, "config.toml"),
          );
          // What Codex and the user then write in a home with no file links.
          yield* writeTextFile(path.join(shadowHome, "state_5.sqlite"), "shadow-db");
          yield* writeTextFile(path.join(shadowHome, ".sqlite-maintenance.lock"), "");
          yield* writeTextFile(path.join(shadowHome, "AGENTS.md"), "shadow instructions\n");
          yield* writeTextFile(path.join(sharedHome, "config.toml"), 'model = "changed"\n');
          yield* materializeCodexShadowHome(layout).pipe(refuseSymlinksLikeWindows);

          yield* writeTextFile(path.join(shadowHome, "sessions", "rollout.jsonl"), "{}\n");
          expect(yield* fileSystem.exists(path.join(sharedHome, "sessions", "rollout.jsonl"))).toBe(
            true,
          );
          expect(configAfterFirstPass).toBe('model = "gpt-5-codex"\n');
          expect(yield* fileSystem.readFileString(path.join(shadowHome, "config.toml"))).toBe(
            'model = "gpt-5-codex"\n',
          );
          expect(yield* fileSystem.readFileString(path.join(shadowHome, "AGENTS.md"))).toBe(
            "shadow instructions\n",
          );
          expect(yield* fileSystem.exists(path.join(shadowHome, "history.jsonl"))).toBe(false);
          expect(yield* fileSystem.exists(path.join(shadowHome, ".sqlite-maintenance.lock"))).toBe(
            true,
          );
          expect(yield* fileSystem.readFileString(path.join(shadowHome, "state_5.sqlite"))).toBe(
            "shadow-db",
          );
          expect(yield* fileSystem.readFileString(path.join(sharedHome, "state_5.sqlite"))).toBe(
            "shared-db",
          );
        }),
    );

    it.effect("copies the setup into a refused shadow home that was interrupted before it", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sharedHome = yield* makeTempDir("t3code-codex-shared-");
        const shadowRoot = yield* makeTempDir("t3code-codex-shadow-root-");
        const shadowHome = path.join(shadowRoot, "shadow");
        yield* writeTextFile(path.join(sharedHome, "config.toml"), 'model = "gpt-5-codex"\n');
        yield* writeTextFile(path.join(shadowHome, ".t3-local-files"), "");
        const layout = yield* resolveCodexHomeLayout(
          decodeCodexSettings({ homePath: sharedHome, shadowHomePath: shadowHome }),
        );

        yield* materializeCodexShadowHome(layout).pipe(refuseSymlinksLikeWindows);

        expect(yield* fileSystem.readFileString(path.join(shadowHome, "config.toml"))).toBe(
          'model = "gpt-5-codex"\n',
        );
      }),
    );

    it.effect("never leaves a partly written copy of the setup in a refused shadow home", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sharedHome = yield* makeTempDir("t3code-codex-shared-");
        const shadowRoot = yield* makeTempDir("t3code-codex-shadow-root-");
        const shadowHome = path.join(shadowRoot, "shadow");
        const config = 'model = "gpt-5-codex"\n';
        yield* writeTextFile(path.join(sharedHome, "config.toml"), config);
        const layout = yield* resolveCodexHomeLayout(
          decodeCodexSettings({ homePath: sharedHome, shadowHomePath: shadowHome }),
        );

        const interrupted = yield* materializeCodexShadowHome(layout).pipe(
          interruptWritesTo("config.toml"),
          refuseSymlinksLikeWindows,
          Effect.flip,
        );
        const copiedAfterInterruption = yield* fileSystem.exists(
          path.join(shadowHome, "config.toml"),
        );
        yield* materializeCodexShadowHome(layout).pipe(refuseSymlinksLikeWindows);

        expect(interrupted).toMatchObject({ operation: "copyFile", entryName: "config.toml" });
        expect(copiedAfterInterruption).toBe(false);
        expect(yield* fileSystem.readFileString(path.join(shadowHome, "config.toml"))).toBe(config);
      }),
    );

    it.effect("keeps a published copy whole when two refreshes copy the same file", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sharedHome = yield* makeTempDir("t3code-codex-shared-");
        const shadowRoot = yield* makeTempDir("t3code-codex-shadow-root-");
        const shadowHome = path.join(shadowRoot, "shadow");
        const config = 'model = "gpt-5-codex"\n';
        const layout = yield* resolveCodexHomeLayout(
          decodeCodexSettings({ homePath: sharedHome, shadowHomePath: shadowHome }),
        );
        yield* materializeCodexShadowHome(layout).pipe(refuseSymlinksLikeWindows);
        yield* writeTextFile(path.join(sharedHome, "config.toml"), config);

        // The second refresh opens its copy only after the first has published, then dies.
        const firstPublished = yield* Deferred.make<void>();
        let copiesOpened = 0;
        const interleaved = FileSystem.FileSystem.of({
          ...fileSystem,
          link: (from, to) =>
            fileSystem
              .link(from, to)
              .pipe(Effect.andThen(Deferred.succeed(firstPublished, void 0))),
          open: (filePath, options) => {
            if (!filePath.includes(".t3-copy-") || ++copiesOpened === 1) {
              return fileSystem.open(filePath, options);
            }
            return Deferred.await(firstPublished).pipe(
              Effect.andThen(fileSystem.open(filePath, options)),
              Effect.andThen(Effect.die("second refresh interrupted")),
            );
          },
        });
        const refresh = materializeCodexShadowHome(layout).pipe(
          refuseSymlinksLikeWindows,
          Effect.provideService(FileSystem.FileSystem, interleaved),
          Effect.exit,
        );
        yield* Effect.all([refresh, refresh], { concurrency: 2 });

        expect(copiesOpened).toBe(2);
        expect(yield* fileSystem.readFileString(path.join(shadowHome, "config.toml"))).toBe(config);
      }),
    );

    it.effect("copies the setup whatever the case of its file names on Windows", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sharedHome = yield* makeTempDir("t3code-codex-shared-");
        const shadowRoot = yield* makeTempDir("t3code-codex-shadow-root-");
        const shadowHome = path.join(shadowRoot, "shadow");
        yield* writeTextFile(path.join(sharedHome, "Config.toml"), 'model = "gpt-5-codex"\n');
        yield* writeTextFile(path.join(sharedHome, "agents.md"), "shared instructions\n");
        const layout = yield* resolveCodexHomeLayout(
          decodeCodexSettings({ homePath: sharedHome, shadowHomePath: shadowHome }),
        );

        yield* materializeCodexShadowHome(layout).pipe(refuseSymlinksLikeWindows);

        expect(yield* fileSystem.readFileString(path.join(shadowHome, "Config.toml"))).toBe(
          'model = "gpt-5-codex"\n',
        );
        expect(yield* fileSystem.readFileString(path.join(shadowHome, "agents.md"))).toBe(
          "shared instructions\n",
        );
      }),
    );

    it.effect("keeps a refused shadow home's files local once symlinks are allowed", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sharedHome = yield* makeTempDir("t3code-codex-shared-");
        const shadowRoot = yield* makeTempDir("t3code-codex-shadow-root-");
        const shadowHome = path.join(shadowRoot, "shadow");
        yield* writeTextFile(path.join(sharedHome, "state_5.sqlite"), "shared-db");
        const layout = yield* resolveCodexHomeLayout(
          decodeCodexSettings({ homePath: sharedHome, shadowHomePath: shadowHome }),
        );

        yield* materializeCodexShadowHome(layout).pipe(refuseSymlinksLikeWindows);
        yield* writeTextFile(path.join(shadowHome, "state_5.sqlite"), "shadow-db");
        yield* materializeCodexShadowHome(layout).pipe(
          Effect.provideService(HostProcess.Platform, "win32"),
        );

        expect(yield* fileSystem.readFileString(path.join(shadowHome, "state_5.sqlite"))).toBe(
          "shadow-db",
        );
      }),
    );

    it.effect("rejects shadow homes that point at the shared home", () =>
      Effect.gen(function* () {
        const sharedHome = yield* makeTempDir("t3code-codex-shared-");
        const layout = yield* resolveCodexHomeLayout(
          decodeCodexSettings({
            homePath: sharedHome,
            shadowHomePath: sharedHome,
          }),
        );

        const error = yield* materializeCodexShadowHome(layout).pipe(Effect.flip);

        expect(error).toBeInstanceOf(CodexShadowHomePathConflictError);
        expect(error).toMatchObject({
          sharedHomePath: sharedHome,
          effectiveHomePath: sharedHome,
        });
        expect(error.message).toBe(
          `Codex shadow home path '${sharedHome}' must be different from the shared home path '${sharedHome}'.`,
        );
      }),
    );

    it.effect.skipIf(!symlinksSupported)(
      "rejects shared entries that already exist in the shadow home as real files",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const sharedHome = yield* makeTempDir("t3code-codex-shared-");
          const shadowRoot = yield* makeTempDir("t3code-codex-shadow-root-");
          const shadowHome = path.join(shadowRoot, "shadow");
          yield* writeTextFile(path.join(sharedHome, "config.toml"), 'model = "gpt-5-codex"\n');
          yield* writeTextFile(path.join(shadowHome, "config.toml"), 'model = "local"\n');

          const layout = yield* resolveCodexHomeLayout(
            decodeCodexSettings({
              homePath: sharedHome,
              shadowHomePath: shadowHome,
            }),
          );

          const error = yield* materializeCodexShadowHome(layout).pipe(Effect.flip);

          expect(error).toBeInstanceOf(CodexShadowHomeEntryConflictError);
          expect(error).toMatchObject({
            sharedHomePath: sharedHome,
            effectiveHomePath: shadowHome,
            entryName: "config.toml",
            linkPath: path.join(shadowHome, "config.toml"),
            targetPath: path.join(sharedHome, "config.toml"),
          });
          expect(error.message).toBe(
            `Cannot create Codex shadow home entry 'config.toml' because '${path.join(shadowHome, "config.toml")}' already exists and is not a symlink.`,
          );
        }),
    );

    it.effect("preserves filesystem operation, paths, and cause", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sharedRoot = yield* makeTempDir("t3code-codex-shared-root-");
        const sharedHome = path.join(sharedRoot, "shared-home");
        const shadowRoot = yield* makeTempDir("t3code-codex-shadow-root-");
        const shadowHome = path.join(shadowRoot, "shadow");
        yield* writeTextFile(sharedHome, "not a directory\n");

        const layout = yield* resolveCodexHomeLayout(
          decodeCodexSettings({
            homePath: sharedHome,
            shadowHomePath: shadowHome,
          }),
        );

        const error = yield* materializeCodexShadowHome(layout).pipe(Effect.flip);

        expect(error._tag).toBe("CodexShadowHomeFileSystemError");
        if (error._tag !== "CodexShadowHomeFileSystemError") {
          return expect.fail("Expected CodexShadowHomeFileSystemError");
        }
        expect(error).toMatchObject({
          operation: "makeDirectory",
          sharedHomePath: sharedHome,
          effectiveHomePath: shadowHome,
        });
        expect(error.path.startsWith(sharedHome)).toBe(true);
        expect(error.cause).toBeInstanceOf(PlatformError.PlatformError);
        expect(error.message).toBe(
          `Codex shadow home filesystem operation 'makeDirectory' failed for '${error.path}'.`,
        );
      }),
    );
  });
});
