import { describe, expect, it } from "vite-plus/test";

import { nextAnimationFrame, resolvePetState } from "./petModel";

describe("petModel", () => {
  it("prioritizes direct interaction, then errors, input, work, and completion", () => {
    const base = {
      isDragging: false,
      dragDirection: "right" as const,
      reaction: null,
      isBatting: false,
      hasError: false,
      needsInput: false,
      isWorking: false,
      isReady: false,
    };
    expect(resolvePetState({ ...base, isReady: true })).toBe("review");
    expect(resolvePetState({ ...base, isReady: true, isWorking: true })).toBe("running");
    expect(resolvePetState({ ...base, isWorking: true, needsInput: true })).toBe("waiting");
    expect(resolvePetState({ ...base, needsInput: true, hasError: true })).toBe("failed");
    expect(resolvePetState({ ...base, hasError: true, reaction: "waving" })).toBe("waving");
    expect(resolvePetState({ ...base, reaction: "waving", isBatting: true })).toBe("batting");
    expect(resolvePetState({ ...base, reaction: "jumping", isDragging: true })).toBe(
      "running-right",
    );
  });

  it("loops from loopStart and holds the last frame for one-shots", () => {
    const frames = [
      { spriteIndex: 0, durationMs: 10 },
      { spriteIndex: 1, durationMs: 10 },
    ];
    expect(nextAnimationFrame({ frames, loopStart: 0, fallback: "idle" }, 1)).toEqual({
      index: 0,
      completed: false,
    });
    expect(nextAnimationFrame({ frames, loopStart: null, fallback: "idle" }, 1)).toEqual({
      index: 1,
      completed: true,
    });
  });
});
