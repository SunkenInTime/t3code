import { describe, expect, it } from "vite-plus/test";

import { advanceFallingText, type FallingTextState } from "./petTextPhysics";

const airborne: FallingTextState = {
  x: 10,
  y: 20,
  velocityX: 100,
  velocityY: 0,
  rotation: 0,
  angularVelocity: 90,
  bounces: 0,
};

describe("petTextPhysics", () => {
  it("applies gravity, horizontal motion, and spin", () => {
    const next = advanceFallingText(airborne, 0.1, 1_000, 20);

    expect(next.x).toBeGreaterThan(airborne.x);
    expect(next.y).toBeGreaterThan(airborne.y);
    expect(next.velocityY).toBeGreaterThan(0);
    expect(next.rotation).toBe(9);
  });

  it("bounces at the floor and settles after repeated impacts", () => {
    const impact = { ...airborne, y: 90, velocityY: 200 };
    const first = advanceFallingText(impact, 0.1, 100, 10);
    const settled = advanceFallingText({ ...impact, bounces: 2 }, 0.1, 100, 10);

    expect(first.y).toBe(90);
    expect(first.velocityY).toBeLessThan(0);
    expect(first.bounces).toBe(1);
    expect(settled.velocityY).toBe(0);
    expect(settled.bounces).toBe(3);
  });
});
