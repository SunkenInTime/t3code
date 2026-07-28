import type { PetAnimation, PetCatalogEntry } from "@t3tools/contracts";

export type PetState =
  | "idle"
  | "running-left"
  | "running-right"
  | "batting"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export interface PetThreadState {
  readonly isDragging: boolean;
  readonly dragDirection: "left" | "right";
  readonly reaction: "waving" | "jumping" | null;
  readonly isBatting: boolean;
  readonly hasError: boolean;
  readonly needsInput: boolean;
  readonly isWorking: boolean;
  readonly isReady: boolean;
}

export function resolvePetState(input: PetThreadState): PetState {
  if (input.isDragging) {
    return input.dragDirection === "left" ? "running-left" : "running-right";
  }
  if (input.isBatting) return "batting";
  if (input.reaction) return input.reaction;
  if (input.hasError) return "failed";
  if (input.needsInput) return "waiting";
  if (input.isWorking) return "running";
  if (input.isReady) return "review";
  return "idle";
}

export function petStateLabel(state: PetState): string | null {
  switch (state) {
    case "running":
      return "Running";
    case "waiting":
      return "Needs input";
    case "review":
      return "Ready";
    case "failed":
      return "Blocked";
    default:
      return null;
  }
}

export function animationForState(pet: PetCatalogEntry, state: PetState): PetAnimation {
  return pet.animations[state] ?? pet.animations.idle ?? fallbackAnimation();
}

export function fallbackAnimation(): PetAnimation {
  return {
    frames: [{ spriteIndex: 0, durationMs: 1000 }],
    loopStart: 0,
    fallback: "idle",
  };
}

export function nextAnimationFrame(
  animation: PetAnimation,
  currentIndex: number,
): { readonly index: number; readonly completed: boolean } {
  const nextIndex = currentIndex + 1;
  if (nextIndex < animation.frames.length) return { index: nextIndex, completed: false };
  if (animation.loopStart !== null && animation.loopStart < animation.frames.length) {
    return { index: animation.loopStart, completed: false };
  }
  return { index: Math.max(0, animation.frames.length - 1), completed: true };
}
