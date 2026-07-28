const BAT_TARGET_SELECTOR = ["p", "li", "h1", "h2", "h3", "h4", "blockquote", "td", "th"].join(",");

export interface FallingTextState {
  readonly x: number;
  readonly y: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly rotation: number;
  readonly angularVelocity: number;
  readonly bounces: number;
}

export function advanceFallingText(
  state: FallingTextState,
  deltaSeconds: number,
  floorY: number,
  height: number,
): FallingTextState {
  const velocityY = state.velocityY + 1_560 * deltaSeconds;
  let y = state.y + velocityY * deltaSeconds;
  let nextVelocityY = velocityY;
  let bounces = state.bounces;
  if (y + height >= floorY && velocityY > 0) {
    y = floorY - height;
    nextVelocityY = bounces >= 2 ? 0 : -velocityY * 0.34;
    bounces += 1;
  }
  return {
    x: state.x + state.velocityX * deltaSeconds,
    y,
    velocityX: state.velocityX * Math.max(0, 1 - 0.3 * deltaSeconds),
    velocityY: nextVelocityY,
    rotation: state.rotation + state.angularVelocity * deltaSeconds,
    angularVelocity: state.angularVelocity * Math.max(0, 1 - 0.18 * deltaSeconds),
    bounces,
  };
}

function isVisibleBatTarget(element: HTMLElement): boolean {
  if (element.dataset.petFalling === "true") return false;
  const text = element.textContent?.trim() ?? "";
  if (text.length < 4 || text.length > 600) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 24 || rect.height < 8) return false;
  if (rect.bottom < 24 || rect.top > window.innerHeight - 72) return false;
  if (rect.right < 24 || rect.left > window.innerWidth - 24) return false;
  return window.getComputedStyle(element).visibility !== "hidden";
}

export function findBatTarget(random = Math.random): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-pet-battable="true"] ${BAT_TARGET_SELECTOR}`),
  ).filter(isVisibleBatTarget);
  if (candidates.length === 0) return null;

  // Favor the newest visible output while leaving the exact victim unpredictable.
  const recent = candidates.slice(-8);
  return recent[Math.floor(random() * recent.length)] ?? null;
}

function stripCloneIdentity(root: HTMLElement): void {
  root.removeAttribute("id");
  root.querySelectorAll<HTMLElement>("[id]").forEach((element) => element.removeAttribute("id"));
  root.querySelectorAll<HTMLElement>("a,button,input,textarea,select").forEach((element) => {
    element.setAttribute("tabindex", "-1");
  });
}

export function knockBatTarget(
  target: HTMLElement,
  options: {
    readonly direction?: -1 | 1;
    readonly floorY?: number;
    readonly random?: () => number;
  } = {},
): () => void {
  const rect = target.getBoundingClientRect();
  const clone = target.cloneNode(true) as HTMLElement;
  const computedStyle = window.getComputedStyle(target);
  const random = options.random ?? Math.random;
  const direction = options.direction ?? 1;
  const floorY = options.floorY ?? window.innerHeight - 18;
  const previousVisibility = target.style.getPropertyValue("visibility");
  const previousVisibilityPriority = target.style.getPropertyPriority("visibility");
  let restored = false;
  let animationFrame = 0;
  let restoreTimer = 0;

  stripCloneIdentity(clone);
  clone.setAttribute("aria-hidden", "true");
  clone.dataset.petFallingClone = "true";
  Object.assign(clone.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    pointerEvents: "none",
    color: computedStyle.color,
    font: computedStyle.font,
    fontSize: computedStyle.fontSize,
    fontWeight: computedStyle.fontWeight,
    letterSpacing: computedStyle.letterSpacing,
    lineHeight: computedStyle.lineHeight,
    textAlign: computedStyle.textAlign,
    transformOrigin: "center center",
    willChange: "transform, opacity",
    zIndex: "39",
  });
  target.dataset.petFalling = "true";
  target.style.setProperty("visibility", "hidden");
  document.body.append(clone);

  const restoreOriginal = () => {
    if (restored) return;
    restored = true;
    delete target.dataset.petFalling;
    if (previousVisibility) {
      target.style.setProperty("visibility", previousVisibility, previousVisibilityPriority);
    } else {
      target.style.removeProperty("visibility");
    }
  };

  let state: FallingTextState = {
    x: rect.left,
    y: rect.top,
    velocityX: direction * (145 + random() * 95),
    velocityY: -(170 + random() * 90),
    rotation: 0,
    angularVelocity: direction * (105 + random() * 85),
    bounces: 0,
  };
  let startedAt = 0;
  let previousAt = 0;

  const finish = () => {
    window.cancelAnimationFrame(animationFrame);
    window.clearTimeout(restoreTimer);
    restoreOriginal();
    clone.remove();
  };

  const animate = (now: number) => {
    if (startedAt === 0) {
      startedAt = now;
      previousAt = now;
    }
    const elapsed = now - startedAt;
    const deltaSeconds = Math.min(0.034, Math.max(0, (now - previousAt) / 1000));
    previousAt = now;
    state = advanceFallingText(state, deltaSeconds, floorY, rect.height);
    const fade = elapsed > 2_050 ? Math.max(0, 1 - (elapsed - 2_050) / 450) : 1;
    clone.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) rotate(${state.rotation}deg)`;
    clone.style.opacity = String(fade);
    if (elapsed >= 2_500) {
      finish();
      return;
    }
    animationFrame = window.requestAnimationFrame(animate);
  };

  // Preserve the joke without making generated output unreadable for the full fall.
  restoreTimer = window.setTimeout(restoreOriginal, 850);
  animationFrame = window.requestAnimationFrame(animate);
  return finish;
}
