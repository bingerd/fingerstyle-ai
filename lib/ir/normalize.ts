import { Song } from "./schema";

/** Upgrade songs saved before fingerstyle support (no beats/texture/transpose) and validate the shape. */
export function normalizeSong(raw: unknown): Song {
  const s = structuredClone(raw) as Record<string, unknown> & { sections?: { bars?: Record<string, unknown>[] }[] };
  s.texture ??= "comping";
  s.transpose ??= 0;
  s.tuning ??= "standard";
  s.capo ??= 0;
  for (const sec of s.sections ?? [])
    for (const bar of sec.bars ?? []) {
      bar.beats ??= [];
      for (const beat of bar.beats as Record<string, unknown>[]) {
        beat.triplet ??= false;
        beat.percussion ??= "none";
        for (const n of (beat.notes ?? []) as Record<string, unknown>[]) n.technique ??= "none";
      }
    }
  return Song.parse(s);
}
