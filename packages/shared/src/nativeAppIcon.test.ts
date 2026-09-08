import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { HostProcessPlatform } from "./hostProcess.ts";
import { readImageDimensions } from "./imageDimensions.ts";
import { makeApplicationResolver, makeNativeAppIconResolver } from "./nativeAppIcon.ts";

const decodeRenderRequest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      path: Schema.String,
      outputPath: Schema.String,
      size: Schema.Number,
    }),
  ),
);
const decodeInput = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const processHandle = (output = "") =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(new TextEncoder().encode(output)),
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });

it.effect(
  "uses the capture's known path, caches the icon, and recovers a deleted PNG on Windows",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      const executable = path.join(directory, "Review ' $() App.exe");
      yield* fs.writeFileString(executable, "executable fixture");
      let renders = 0;
      const spawner = ChildProcessSpawner.make((command) =>
        Effect.gen(function* () {
          if (command._tag !== "StandardCommand") return yield* Effect.die("Unexpected pipeline");
          const request = decodeRenderRequest(command.options.env!.T3_NATIVE_APP_INPUT!);
          expect(request.path).toBe(executable);
          expect(request.size).toBe(128);
          expect(command.args.join(" ")).not.toContain(executable);
          yield* fs.writeFileString(request.outputPath, "rendered PNG");
          renders++;
          return processHandle();
        }),
      );
      yield* Effect.gen(function* () {
        const resolver = yield* makeNativeAppIconResolver(path.join(directory, "icons"), 128).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(HostProcessPlatform, "win32"),
        );
        const app = { _tag: "path", path: executable } as const;
        const icon = yield* resolver.resolve(app);
        expect(icon).not.toBeNull();
        expect(yield* resolver.resolve(app)).toBe(icon);
        expect(renders).toBe(1);
        yield* fs.remove(icon!);
        expect(yield* resolver.resolve(app)).toBe(icon);
        expect(renders).toBe(2);
      }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("preserves Windows executable names and packaged app IDs as lookup data", () =>
  Effect.gen(function* () {
    const references: unknown[] = [];
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        if (command._tag !== "StandardCommand") throw new Error("Unexpected pipeline");
        references.push(decodeInput(command.options.env!.T3_NATIVE_APP_INPUT!));
        return processHandle(
          '{"path":"C:\\\\Apps\\\\Review.exe","displayName":"Review","version":"1"}',
        );
      }),
    );
    const resolve = yield* makeApplicationResolver().pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(HostProcessPlatform, "win32"),
    );
    for (const appId of ["review.exe", "Review_123!App"]) {
      const reference = { _tag: "app-id", appId } as const;
      expect(yield* resolve(reference)).toMatchObject({ displayName: "Review" });
      expect(yield* resolve(reference)).toMatchObject({ displayName: "Review" });
      expect(references.at(-1)).toEqual(reference);
    }
    expect(references).toHaveLength(2);
  }),
);

it.effect.skipIf(
  HostProcessPlatform.defaultValue() !== "darwin" && HostProcessPlatform.defaultValue() !== "win32",
)(
  "renders a native app icon without Electron at desktop and tool-activity sizes",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const app =
        HostProcessPlatform.defaultValue() === "darwin"
          ? ({ _tag: "path", path: "/System/Library/CoreServices/Finder.app" } as const)
          : ({ _tag: "path", path: `${process.env.SYSTEMROOT}\\System32\\cmd.exe` } as const);
      const byId = yield* makeNativeAppIconResolver(directory);
      const resolved = yield* byId.resolve({
        _tag: "app-id",
        appId: HostProcessPlatform.defaultValue() === "darwin" ? "com.apple.finder" : "cmd.exe",
      });
      expect(resolved).not.toBeNull();
      expect(readImageDimensions(yield* fs.readFile(resolved!))).toEqual({ width: 64, height: 64 });
      for (const size of [64, 128]) {
        const resolver = yield* makeNativeAppIconResolver(directory, size);
        const icon = yield* resolver.resolve(app);
        expect(icon).not.toBeNull();
        expect(readImageDimensions(yield* fs.readFile(icon!))).toEqual({
          width: size,
          height: size,
        });
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  { timeout: 30_000 },
);
