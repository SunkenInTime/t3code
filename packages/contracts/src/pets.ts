import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const PetAnimationFrame = Schema.Struct({
  spriteIndex: Schema.Int,
  durationMs: Schema.Int,
});
export type PetAnimationFrame = typeof PetAnimationFrame.Type;

export const PetAnimation = Schema.Struct({
  frames: Schema.Array(PetAnimationFrame),
  loopStart: Schema.NullOr(Schema.Int),
  fallback: TrimmedNonEmptyString,
});
export type PetAnimation = typeof PetAnimation.Type;

export const PetCatalogEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  description: Schema.String,
  source: Schema.Literals(["builtin", "custom"]),
  spritesheetUrl: TrimmedNonEmptyString,
  frameWidth: Schema.Int,
  frameHeight: Schema.Int,
  columns: Schema.Int,
  rows: Schema.Int,
  animations: Schema.Record(Schema.String, PetAnimation),
});
export type PetCatalogEntry = typeof PetCatalogEntry.Type;

export const PetCatalogResult = Schema.Struct({
  pets: Schema.Array(PetCatalogEntry),
});
export type PetCatalogResult = typeof PetCatalogResult.Type;
