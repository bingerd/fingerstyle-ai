import { z } from "zod";
import type { Tune } from "@/lib/tune/tune";
import type { Direction } from "@/lib/arrange/plan";

/**
 * Song IR — the single source of truth for every arrangement.
 * Claude produces it (structured outputs), the theory layer validates it,
 * and lib/alphatex converts it into notation. The LLM never writes tab text.
 *
 * Keep this schema free of length/min/max constraints: structured outputs
 * support a limited JSON Schema subset. Those rules live in lib/theory/validate.ts.
 */

/** One rhythmic event inside a chord's slot. */
export const RhythmEvent = z.object({
  /** Note value: 1 = whole, 2 = half, 4 = quarter, 8 = eighth, 16 = sixteenth. */
  value: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
  dotted: z.boolean(),
  /**
   * What is struck: "all" = full voicing, "bass" = lowest sounding string only,
   * "upper" = everything except the bass, "rest" = silence.
   */
  play: z.enum(["all", "bass", "upper", "rest"]),
});
export type RhythmEvent = z.infer<typeof RhythmEvent>;

export const Voicing = z.object({
  /** 6 entries, low E string first (like "x32000"). -1 = muted, 0 = open. */
  frets: z.array(z.number().int()),
  /** 6 entries, low E first. 0 = none/open, 1-4 = index..pinky, 5 = thumb. */
  fingers: z.array(z.number().int()),
});
export type Voicing = z.infer<typeof Voicing>;

export const ChordEvent = z.object({
  /** Stable id, e.g. "c1", "c2"… unique within the song. */
  id: z.string(),
  /** Chord symbol, e.g. "Cmaj7", "G7b9", "F#m7b5", "C/E". */
  symbol: z.string(),
  /** Roman-numeral function relative to the song key, e.g. "ii7", "V7/ii", "bVII7". */
  roman: z.string(),
  voicing: Voicing,
  /** Rhythm for this chord's slot; durations must fill the slot exactly. */
  rhythm: z.array(RhythmEvent),
});
export type ChordEvent = z.infer<typeof ChordEvent>;

export const TECHNIQUES = [
  "none",
  "hammer", // reached by hammer-on from the previous note on this string
  "pull", // reached by pull-off from the previous note on this string
  "slide", // reached by sliding from the previous note on this string
  "harmonic", // natural harmonic (frets 12, 7, 5, 4…)
  "artificial-harmonic", // fretted note + harmonic an octave up (harp harmonic)
  "dead", // muted percussive "x" note
  "tap", // right-hand tap
  "vibrato",
] as const;

/** One fretted note in explicit tab. string 1 = high e … 6 = low E (standard tab numbering). */
export const TabNote = z.object({
  string: z.number().int(),
  fret: z.number().int(),
  technique: z.enum(TECHNIQUES),
});
export type TabNote = z.infer<typeof TabNote>;

/** One attack (or rest, when notes is empty) in explicit fingerstyle tab. */
export const TabBeat = z.object({
  value: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16), z.literal(32)]),
  dotted: z.boolean(),
  /** Part of a triplet (3 in the time of 2). */
  triplet: z.boolean(),
  /**
   * Right-hand percussion on this beat: "slap" = thumb slap on the bass strings (snare-like backbeat),
   * "body" = knock on the guitar body (kick-like). Can be combined with plucked notes.
   */
  percussion: z.enum(["none", "slap", "body"]),
  notes: z.array(TabNote),
  /** Chord symbol to label above this beat ("" for none). Must match one of the bar's chords. */
  chord: z.string(),
});
export type TabBeat = z.infer<typeof TabBeat>;

export const Bar = z.object({
  /** The harmony of the bar (drives the chord chart and reharm). */
  chords: z.array(ChordEvent),
  /**
   * Explicit tab for fingerstyle / chord-melody. Empty = comping: the chords' rhythms are played.
   * Non-empty = these beats are played and notated instead.
   */
  beats: z.array(TabBeat),
});
export type Bar = z.infer<typeof Bar>;

export const Section = z.object({
  name: z.string(),
  bars: z.array(Bar),
  /** Short study note for this section (voice leading, devices, what to listen for). */
  note: z.string(),
});
export type Section = z.infer<typeof Section>;

export const TasteNote = z.object({
  kind: z.enum(["voice-leading", "style", "technique", "practice", "listen"]),
  title: z.string(),
  body: z.string(),
});
export type TasteNote = z.infer<typeof TasteNote>;

export const Song = z.object({
  title: z.string(),
  style: z.string(),
  key: z.string(),
  tempo: z.number().int(),
  timeSignature: z.object({ numerator: z.number().int(), denominator: z.number().int() }),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  /** "comping" = strummed/plucked chords; "fingerstyle" = explicit tab with melody, bass and harmony. */
  texture: z.enum(["comping", "fingerstyle"]),
  tuning: z.enum(["standard", "drop-d", "dadgad", "open-d", "open-g", "half-step-down"]),
  capo: z.number().int(),
  /** Semitones the arrangement is transposed relative to an imported tune's melody (0 if none). */
  transpose: z.number().int(),
  /** One-paragraph overview of the arrangement's concept. */
  summary: z.string(),
  sections: z.array(Section),
  tasteNotes: z.array(TasteNote),
});
export type Song = z.infer<typeof Song>;

/** A reharmonization option: replaces one chord's slot with one or more chords. */
export const ReharmOption = z.object({
  technique: z.string(),
  /** Replacement chords; their rhythms together must fill the original chord's slot. */
  chords: z.array(ChordEvent),
  /** Fingerstyle songs only: the complete rewritten tab for the bar containing the target chord. Empty for comping. */
  beats: z.array(TabBeat),
  why: z.string(),
  color: z.enum(["subtle", "colorful", "bold"]),
});
export type ReharmOption = z.infer<typeof ReharmOption>;

export const ReharmResponse = z.object({
  options: z.array(ReharmOption),
});
export type ReharmResponse = z.infer<typeof ReharmResponse>;

/** Saved library entry. */
export type SavedSong = { id: string; savedAt: string; song: Song; tune?: Tune; direction?: Direction };
