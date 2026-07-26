import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createPetEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pets:list",
      tag: WS_METHODS.petsList,
      staleTimeMs: 30_000,
      idleTtlMs: 5 * 60_000,
      refreshIntervalMs: 30 * 60_000,
    }),
  };
}
