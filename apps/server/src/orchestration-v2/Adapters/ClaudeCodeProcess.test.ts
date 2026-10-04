// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ProviderProcessLedger from "../../provider/ProviderProcessLedger.ts";
import { type ClaudeCodeProcess, makeClaudeCodeProcessFactory } from "./ClaudeCodeProcess.ts";

const groupExists = (pgid: number) => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Stands in for a T3 server: alive while its ledger is created, SIGKILLed later. */
const spawnServer = Effect.acquireRelease(
  Effect.sync(() =>
    NodeChildProcess.spawn("/bin/sh", ["-c", "sleep 600"], { detached: true, stdio: "ignore" }),
  ),
  (server) => Effect.sync(() => server.kill("SIGKILL")),
);

const waitForExit = (child: NodeChildProcess.ChildProcess) =>
  Effect.callback<NodeJS.Signals | null>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.succeed(child.signalCode));
      return;
    }
    child.once("exit", (_code, signal) => resume(Effect.succeed(signal)));
  });

/**
 * A Claude Code factory whose ledger belongs to `ownerPid` and reports when a
 * spawn has been recorded and when it has been forgotten.
 */
const makeFactory = (stateDir: string, ownerPid: number) =>
  Effect.gen(function* () {
    const ledger = yield* ProviderProcessLedger.make({ stateDir, ownerPid });
    const recorded = yield* Deferred.make<void>();
    const forgotten = yield* Deferred.make<void>();
    const factory = yield* makeClaudeCodeProcessFactory.pipe(
      Effect.provideService(
        ProviderProcessLedger.ProviderProcessLedger,
        ProviderProcessLedger.ProviderProcessLedger.of({
          track: (spawned) =>
            ledger.track(spawned).pipe(
              Effect.tap(() => Deferred.succeed(recorded, undefined)),
              Effect.map((forget) =>
                Effect.andThen(forget, Deferred.succeed(forgotten, undefined)),
              ),
            ),
        }),
      ),
    );
    if (factory === undefined) return yield* Effect.die("no Claude Code spawner on this platform");
    return {
      factory,
      recorded: Deferred.await(recorded),
      forgotten: Deferred.await(forgotten),
    };
  });

const spawnCli = (claudeCode: ClaudeCodeProcess, script: string) =>
  Effect.acquireRelease(
    Effect.sync(
      () =>
        claudeCode.spawn({
          command: "/bin/sh",
          args: ["-c", script, "claude", "--output-format", "stream-json"],
          env: process.env,
          signal: new AbortController().signal,
        }) as NodeChildProcess.ChildProcess,
    ),
    (child) =>
      Effect.sync(() => {
        if (child.pid !== undefined && groupExists(child.pid)) process.kill(-child.pid, "SIGKILL");
      }),
  );

describe.skipIf(process.platform === "win32")("Claude Code process", () => {
  it.live("stops a CLI that outlived a killed server on the next server start", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-process-" });
      const server = yield* spawnServer;
      const { factory, recorded } = yield* makeFactory(stateDir, server.pid!);

      // Like the real CLI mid-turn: it keeps working after stdin closes, and
      // its tool commands run in its process group.
      const cli = yield* spawnCli(factory(), "trap '' HUP; sleep 600 & wait");
      yield* recorded;
      expect(groupExists(cli.pid!)).toBe(true);

      // The server dies without running any finalizer.
      server.kill("SIGKILL");
      yield* waitForExit(server);
      cli.stdin?.destroy();
      cli.stdout?.destroy();

      const restarted = yield* ProviderProcessLedger.make({ stateDir });
      yield* restarted.reapOrphans;

      expect(yield* waitForExit(cli)).toBe("SIGTERM");
      expect(groupExists(cli.pid!)).toBe(false);
      expect(yield* fs.readDirectory(path.join(stateDir, "provider-processes"))).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("forgets a CLI that exits and keeps its stderr for the exit error", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-process-" });
      const { factory, recorded, forgotten } = yield* makeFactory(stateDir, process.pid);
      const claudeCode = factory();

      const cli = yield* spawnCli(claudeCode, "read line; echo 'unknown option --x' >&2; exit 3");
      yield* recorded;
      expect(yield* fs.readDirectory(path.join(stateDir, "provider-processes"))).toHaveLength(1);
      const stderrClosed = Effect.callback<void>((resume) => {
        if (cli.stderr?.closed !== false) resume(Effect.void);
        else cli.stderr.once("close", () => resume(Effect.void));
      });
      cli.stdin?.end("go\n");
      yield* Effect.all([waitForExit(cli), stderrClosed, forgotten]);

      expect(yield* fs.readDirectory(path.join(stateDir, "provider-processes"))).toEqual([]);
      const error = claudeCode.withStderr(new Error("Claude Code process exited with code 3"));
      expect((error as Error).message).toBe(
        "Claude Code process exited with code 3. stderr: unknown option --x",
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
