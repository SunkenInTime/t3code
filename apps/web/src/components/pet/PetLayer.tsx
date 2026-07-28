import { useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { EnvironmentId, PetCatalogEntry } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { CheckIcon, RotateCcwIcon, Settings2Icon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { petEnvironment } from "~/state/pets";
import { usePreparedConnection } from "~/state/session";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import {
  animationForState,
  nextAnimationFrame,
  petStateLabel,
  resolvePetState,
  type PetState,
} from "./petModel";
import { findBatTarget, knockBatTarget } from "./petTextPhysics";

export const OPEN_PET_PICKER_EVENT = "t3:open-pet-picker";
const PET_POSITION_KEY = "t3code:pet-position:v1";
const PET_WIDTH = 96;
const PET_HEIGHT = 104;
const VIEWPORT_MARGIN = 12;

type PetPosition = { readonly x: number; readonly y: number };
type DragState = {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly origin: PetPosition;
  readonly lastX: number;
};

function defaultPosition(): PetPosition {
  return {
    x: Math.max(VIEWPORT_MARGIN, window.innerWidth - PET_WIDTH - 32),
    y: Math.max(VIEWPORT_MARGIN, window.innerHeight - PET_HEIGHT - 190),
  };
}

function clampPosition(position: PetPosition): PetPosition {
  return {
    x: Math.min(
      Math.max(VIEWPORT_MARGIN, position.x),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - PET_WIDTH - VIEWPORT_MARGIN),
    ),
    y: Math.min(
      Math.max(VIEWPORT_MARGIN, position.y),
      Math.max(VIEWPORT_MARGIN, window.innerHeight - PET_HEIGHT - VIEWPORT_MARGIN),
    ),
  };
}

function readPosition(): PetPosition {
  try {
    const value = JSON.parse(localStorage.getItem(PET_POSITION_KEY) ?? "null") as unknown;
    if (
      value &&
      typeof value === "object" &&
      "x" in value &&
      "y" in value &&
      typeof value.x === "number" &&
      typeof value.y === "number"
    ) {
      return clampPosition({ x: value.x, y: value.y });
    }
  } catch {
    // A corrupt optional UI preference should not suppress the pet.
  }
  return defaultPosition();
}

export function usePetCatalog(environmentId: EnvironmentId): ReadonlyArray<PetCatalogEntry> {
  const result = useAtomValue(petEnvironment.list({ environmentId, input: {} }));
  const connection = usePreparedConnection(environmentId);
  return useMemo(() => {
    if (!AsyncResult.isSuccess(result)) return [];
    return result.value.pets.map((pet) => {
      if (/^https:\/\//i.test(pet.spritesheetUrl) || connection._tag === "None") return pet;
      if (pet.spritesheetUrl.startsWith("/pets/")) {
        return {
          ...pet,
          spritesheetUrl: new URL(pet.spritesheetUrl, window.location.origin).href,
        };
      }
      const spritesheetUrl = resolveAssetUrl(connection.value.httpBaseUrl, pet.spritesheetUrl);
      return spritesheetUrl ? { ...pet, spritesheetUrl } : pet;
    });
  }, [connection, result]);
}

function useAnimatedFrame(
  pet: PetCatalogEntry,
  state: PetState,
  animationsEnabled: boolean,
): number {
  const animation = animationForState(pet, state);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
  }, [pet.id, state]);

  useEffect(() => {
    if (!animationsEnabled || animation.frames.length <= 1) return;
    const frame = animation.frames[frameIndex] ?? animation.frames[0];
    if (!frame) return;
    const timer = window.setTimeout(
      () => {
        const next = nextAnimationFrame(animation, frameIndex);
        if (!next.completed) setFrameIndex(next.index);
      },
      Math.max(16, frame.durationMs),
    );
    return () => window.clearTimeout(timer);
  }, [animation, animationsEnabled, frameIndex]);

  return (animation.frames[frameIndex] ?? animation.frames[0])?.spriteIndex ?? 0;
}

function PetSprite(props: {
  readonly pet: PetCatalogEntry;
  readonly state: PetState;
  readonly animationsEnabled: boolean;
  readonly className?: string;
}) {
  const spriteIndex = useAnimatedFrame(props.pet, props.state, props.animationsEnabled);
  const column = spriteIndex % props.pet.columns;
  const row = Math.floor(spriteIndex / props.pet.columns);
  const style: CSSProperties = {
    width: PET_WIDTH,
    height: PET_HEIGHT,
    backgroundImage: `url("${props.pet.spritesheetUrl}")`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${PET_WIDTH * props.pet.columns}px ${PET_HEIGHT * props.pet.rows}px`,
    backgroundPosition: `${-column * PET_WIDTH}px ${-row * PET_HEIGHT}px`,
    imageRendering:
      props.pet.source === "builtin" && props.pet.frameWidth <= 192 ? "pixelated" : "auto",
  };
  return <span aria-hidden="true" className={cn("block", props.className)} style={style} />;
}

export function PetPickerDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pets: ReadonlyArray<PetCatalogEntry>;
  readonly selectedId: string;
  readonly animationsEnabled: boolean;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Choose a pet</DialogTitle>
          <DialogDescription>
            Built-in Codex pets and compatible pets installed in configured Codex homes.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {props.pets.map((pet) => {
            const selected = pet.id === props.selectedId;
            return (
              <button
                key={pet.id}
                type="button"
                className={cn(
                  "relative flex min-w-0 flex-col items-center rounded-xl border p-3 text-center transition-colors hover:bg-accent",
                  selected ? "border-primary bg-primary/6" : "border-border",
                )}
                onClick={() => {
                  props.onSelect(pet.id);
                  props.onOpenChange(false);
                }}
              >
                {selected ? (
                  <span className="absolute right-2 top-2 rounded-full bg-primary p-0.5 text-primary-foreground">
                    <CheckIcon className="size-3" />
                  </span>
                ) : null}
                <PetSprite pet={pet} state="idle" animationsEnabled={props.animationsEnabled} />
                <span className="mt-1 max-w-full truncate text-sm font-medium">
                  {pet.displayName}
                </span>
                <span className="max-w-full truncate text-[11px] text-muted-foreground">
                  {pet.source === "custom" ? "Custom" : "Built in"}
                </span>
              </button>
            );
          })}
          {props.pets.length === 0 ? (
            <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
              Pet catalog is unavailable while this environment reconnects.
            </p>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

export function PetLayer(props: {
  readonly environmentId: EnvironmentId;
  readonly isWorking: boolean;
  readonly needsInput: boolean;
  readonly hasError: boolean;
  readonly isReady: boolean;
}) {
  const settings = useEnvironmentSettings(props.environmentId);
  const updateSettings = useUpdateEnvironmentSettings(props.environmentId);
  const pets = usePetCatalog(props.environmentId);
  const pet = pets.find((candidate) => candidate.id === settings.petId) ?? pets[0] ?? null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [position, setPosition] = useState<PetPosition>(() => readPosition());
  const [dragging, setDragging] = useState(false);
  const [dragDirection, setDragDirection] = useState<"left" | "right">("right");
  const [reaction, setReaction] = useState<"waving" | "jumping" | null>(null);
  const [isBatting, setIsBatting] = useState(false);
  const [isBattingRun, setIsBattingRun] = useState(false);
  const [impactPoint, setImpactPoint] = useState<{ x: number; y: number; key: number } | null>(
    null,
  );
  const dragRef = useRef<DragState | null>(null);
  const reactionTimerRef = useRef<number | null>(null);
  const positionRef = useRef(position);
  const fallingTextCleanupRef = useRef<Set<() => void>>(new Set());
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const animationsEnabled = settings.petAnimations && !reducedMotion;
  const state = resolvePetState({
    isDragging: dragging,
    dragDirection,
    reaction,
    isBatting,
    hasError: props.hasError,
    needsInput: props.needsInput,
    isWorking: props.isWorking,
    isReady: props.isReady,
  });
  const label = petStateLabel(state);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    const openPicker = () => {
      updateSettings({ petEnabled: true });
      setPickerOpen(true);
    };
    window.addEventListener(OPEN_PET_PICKER_EVENT, openPicker);
    return () => window.removeEventListener(OPEN_PET_PICKER_EVENT, openPicker);
  }, [updateSettings]);

  useEffect(() => {
    const onResize = () => {
      setPosition((current) => {
        const next = clampPosition(current);
        localStorage.setItem(PET_POSITION_KEY, JSON.stringify(next));
        return next;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(
    () => () => {
      if (reactionTimerRef.current !== null) window.clearTimeout(reactionTimerRef.current);
      fallingTextCleanupRef.current.forEach((cleanup) => cleanup());
      fallingTextCleanupRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    const canBat =
      settings.petEnabled &&
      settings.petAnimations &&
      !reducedMotion &&
      pet?.id === "builtin:tung-tung-sahur" &&
      props.isWorking &&
      !props.needsInput &&
      !props.hasError &&
      !dragging &&
      !pickerOpen;
    if (!canBat) {
      setIsBatting(false);
      setIsBattingRun(false);
      return;
    }

    const timers = new Set<number>();
    let cancelled = false;
    let homePosition: PetPosition | null = null;
    const later = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (!cancelled) callback();
      }, delay);
      timers.add(timer);
    };

    const scheduleNext = (minimum = 3_800) => {
      later(startBattingRun, minimum + Math.random() * 4_800);
    };

    const startBattingRun = () => {
      const target = findBatTarget();
      if (!target) {
        scheduleNext(1_200);
        return;
      }
      const rect = target.getBoundingClientRect();
      homePosition = positionRef.current;
      const targetPosition = clampPosition({
        x: rect.left - PET_WIDTH + 18,
        y: rect.top + rect.height / 2 - PET_HEIGHT * 0.58,
      });
      setReaction(null);
      setDragDirection("right");
      setIsBattingRun(true);
      setPosition(targetPosition);

      later(() => setIsBatting(true), 560);
      later(() => {
        if (!target.isConnected) return;
        const impactRect = target.getBoundingClientRect();
        setImpactPoint({
          x: Math.max(12, Math.min(window.innerWidth - 12, impactRect.left + 8)),
          y: Math.max(
            12,
            Math.min(window.innerHeight - 12, impactRect.top + impactRect.height / 2),
          ),
          key: Date.now(),
        });
        const cleanup = knockBatTarget(target, { direction: 1 });
        fallingTextCleanupRef.current.add(cleanup);
        later(() => fallingTextCleanupRef.current.delete(cleanup), 2_600);
        later(() => setImpactPoint(null), 420);
      }, 850);
      later(() => setIsBatting(false), 1_180);
      later(() => {
        if (homePosition) setPosition(homePosition);
      }, 1_330);
      later(() => {
        setIsBattingRun(false);
        homePosition = null;
        scheduleNext();
      }, 1_920);
    };

    scheduleNext(2_400);
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      setIsBatting(false);
      setIsBattingRun(false);
      setImpactPoint(null);
      if (homePosition) setPosition(homePosition);
    };
  }, [
    dragging,
    pet?.id,
    pickerOpen,
    props.hasError,
    props.isWorking,
    props.needsInput,
    reducedMotion,
    settings.petAnimations,
    settings.petEnabled,
  ]);

  const triggerReaction = useCallback(() => {
    if (reactionTimerRef.current !== null) window.clearTimeout(reactionTimerRef.current);
    setReaction(Math.random() > 0.45 ? "jumping" : "waving");
    reactionTimerRef.current = window.setTimeout(() => {
      setReaction(null);
      reactionTimerRef.current = null;
    }, 900);
  }, []);

  const finishDrag = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const next = clampPosition({
        x: drag.origin.x + event.clientX - drag.startX,
        y: drag.origin.y + event.clientY - drag.startY,
      });
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      dragRef.current = null;
      setDragging(false);
      setPosition(next);
      localStorage.setItem(PET_POSITION_KEY, JSON.stringify(next));
      if (distance < 8) triggerReaction();
    },
    [triggerReaction],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (Math.abs(event.clientX - drag.lastX) > 1) {
        setDragDirection(event.clientX < drag.lastX ? "left" : "right");
      }
      dragRef.current = { ...drag, lastX: event.clientX };
      setPosition(
        clampPosition({
          x: drag.origin.x + event.clientX - drag.startX,
          y: drag.origin.y + event.clientY - drag.startY,
        }),
      );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [dragging, finishDrag]);

  if (!settings.petEnabled || !pet) {
    return (
      <PetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        pets={pets}
        selectedId={settings.petId}
        animationsEnabled={animationsEnabled}
        onSelect={(petId) => updateSettings({ petEnabled: true, petId })}
      />
    );
  }

  const pointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || isBattingRun) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: position,
      lastX: event.clientX,
    };
    setReaction(null);
    setDragging(true);
  };

  return (
    <>
      <div
        data-codex-pet-layer="true"
        data-pet-state={state}
        className={cn(
          "pointer-events-none fixed z-40",
          isBattingRun && "transition-[left,top] duration-500 ease-in-out",
        )}
        style={{ left: position.x, top: position.y }}
      >
        {label ? (
          <div className="pointer-events-none absolute bottom-[calc(100%+2px)] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border/70 bg-popover/92 px-2.5 py-1 text-[11px] font-medium text-popover-foreground shadow-sm backdrop-blur-md">
            {label}
          </div>
        ) : null}
        <div className="group relative">
          <div className="pointer-events-auto absolute -right-2 -top-3 z-10 flex translate-y-1 gap-0.5 rounded-full border bg-popover/95 p-0.5 opacity-0 shadow-sm transition group-hover:translate-y-0 group-hover:opacity-100 focus-within:translate-y-0 focus-within:opacity-100">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Choose pet"
              title="Choose pet"
              onClick={() => setPickerOpen(true)}
            >
              <Settings2Icon />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Reset pet position"
              title="Reset pet position"
              onClick={() => {
                const next = defaultPosition();
                setPosition(next);
                localStorage.setItem(PET_POSITION_KEY, JSON.stringify(next));
              }}
            >
              <RotateCcwIcon />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Hide pet"
              title="Hide pet"
              onClick={() => updateSettings({ petEnabled: false })}
            >
              <XIcon />
            </Button>
          </div>
          <button
            type="button"
            className={cn(
              "pointer-events-auto relative block cursor-grab select-none rounded-md outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring",
              dragging ? "cursor-grabbing scale-[1.03]" : "hover:scale-[1.02]",
            )}
            style={{ touchAction: "none" }}
            aria-label={`${pet.displayName}. Drag to move, click to interact.`}
            title={pet.displayName}
            onPointerDown={pointerDown}
            onDoubleClick={() => setPickerOpen(true)}
            onContextMenu={(event) => {
              event.preventDefault();
              setPickerOpen(true);
            }}
          >
            <PetSprite
              pet={pet}
              state={state}
              animationsEnabled={animationsEnabled}
              className={cn(
                "drop-shadow-[0_10px_18px_rgba(0,0,0,0.3)]",
                isBatting && "t3-pet-batting-sprite",
              )}
            />
            <span className="absolute -bottom-1 left-1/2 h-2 w-16 -translate-x-1/2 rounded-[50%] bg-black/15 blur-[2px] dark:bg-black/35" />
          </button>
        </div>
      </div>
      {impactPoint ? (
        <span
          key={impactPoint.key}
          aria-hidden="true"
          className="t3-pet-bat-impact pointer-events-none fixed z-40"
          style={{ left: impactPoint.x, top: impactPoint.y }}
        />
      ) : null}
      <PetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        pets={pets}
        selectedId={pet.id}
        animationsEnabled={animationsEnabled}
        onSelect={(petId) => updateSettings({ petEnabled: true, petId })}
      />
    </>
  );
}
