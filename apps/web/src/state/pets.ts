import { createPetEnvironmentAtoms } from "@t3tools/client-runtime/state/pets";

import { connectionAtomRuntime } from "../connection/runtime";

export const petEnvironment = createPetEnvironmentAtoms(connectionAtomRuntime);
