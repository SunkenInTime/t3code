// @effect-diagnostics nodeBuiltinImport:off - Effect's FileSystem has no rmdir.
import * as NodeFSP from "node:fs/promises";

import * as Effect from "effect/Effect";

/**
 * Removes `path` only while it is an empty directory. Succeeds with false when
 * anything else is there, including files written after the caller looked.
 */
export const removeEmptyDirectory = (path: string) =>
  Effect.tryPromise(() => NodeFSP.rmdir(path)).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
