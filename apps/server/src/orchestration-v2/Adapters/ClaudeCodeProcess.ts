// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";

import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import * as ProviderProcessLedger from "../../provider/ProviderProcessLedger.ts";

// The SDK quotes the same amount of stderr in its own exit errors.
const STDERR_TAIL_LENGTH = 2048;

export interface ClaudeCodeProcess {
  /** The Agent SDK's `spawnClaudeCodeProcess`. */
  readonly spawn: (options: SpawnOptions) => SpawnedProcess;
  /**
   * Adds the CLI's stderr tail to an error raised after the CLI exited. The SDK
   * only does this for processes it spawns itself.
   */
  readonly withStderr: (cause: unknown) => unknown;
}

/**
 * Builds a per-query Claude Code process spawner on macOS and Linux, and
 * nothing on Windows.
 *
 * The SDK's own spawn leaves the CLI in the T3 server's process group with
 * nothing tying it to the server's life, so a server that is SIGKILLed or
 * crashes leaves its agents working where no thread can see them. Here the
 * CLI leads its own process group and is recorded in the provider process
 * ledger until it exits, so the next server start stops it before recovery
 * marks its run cancelled. Windows keeps the SDK's spawn: libuv puts the CLI
 * in the server's kill-on-close job object, so it already ends with the server.
 */
export const makeClaudeCodeProcessFactory = Effect.gen(function* () {
  if ((yield* HostProcessPlatform) === "win32") return undefined;
  const ledger = yield* ProviderProcessLedger.ProviderProcessLedger;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());

  return (): ClaudeCodeProcess => {
    let stderrTail = "";
    let exited = false;
    return {
      spawn: (options) => {
        const child = NodeChildProcess.spawn(options.command, options.args, {
          cwd: options.cwd,
          env: options.env,
          signal: options.signal,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          detached: true,
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          stderrTail = `${stderrTail}${chunk}`.slice(-STDERR_TAIL_LENGTH);
        });
        child.once("exit", () => {
          exited = true;
        });
        if (child.pid !== undefined) {
          const recording = runFork(
            ledger.track({ pid: child.pid, args: options.args, label: "Claude Code" }),
          );
          child.once("exit", () => {
            runFork(Fiber.join(recording).pipe(Effect.flatten));
          });
        }
        return child;
      },
      withStderr: (cause) => {
        const tail = stderrTail.trim();
        if (exited && tail !== "" && cause instanceof Error && !cause.message.includes("stderr:")) {
          cause.message = `${cause.message}. stderr: ${tail}`;
        }
        return cause;
      },
    };
  };
});
