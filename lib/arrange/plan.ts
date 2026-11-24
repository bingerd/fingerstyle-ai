import { z } from "zod";
import type { Issue } from "@/lib/theory/validate";
import { tuneToText, type Tune } from "@/lib/tune/tune";

/**
 * Steering controls. Every control except texture may be "auto": the planner then decides
 * from the song itself (melody, harmony, rhythm, mood) instead of a preset.
 */
export const AUTO = "auto" as const;
export const FLAIRS = ["clean", "expressive", "showstopper"] as const;
export const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
export const REHARM_LEVELS = ["none", "light", "moderate", "bold"] as const;
/** exact = every melody note at its time/pitch; embellished = ornaments and ±½-beat displacement; free = theme & variations. */
export const FIDELITIES = ["exact", "embellished", "free"] as const;

export type Flair = (typeof FLAIRS)[number];
export type Fidelity = (typeof FIDELITIES)[number];
export type ReharmLevel = (typeof REHARM_LEVELS)[number];

export const Controls = z.object({
  /** Free-text direction ("jazzy", "cinematic", "make it sound good on solo guitar"). Optional. */
  request: z.string().max(4000).default(""),
  style: z.string().max(100).default(AUTO),
  texture: z.enum(["comping", "fingerstyle"]).default("fingerstyle"),
  flair: z.enum([AUTO, ...FLAIRS]).default(AUTO),
  difficulty: z.enum([AUTO, ...DIFFICULTIES]).default(AUTO),
  reharm: z.enum([AUTO, ...REHARM_LEVELS]).default(AUTO),
  fidelity: z.enum([AUTO, ...FIDELITIES]).default(AUTO),
  position: z.string().max(100).default("No preference"),
  /** short = one 8–16 bar sketch; full = a complete 32–48 bar piece written section by section. */
  length: z.enum([AUTO, "short", "full"]).default(AUTO),
  /** How many distinct arrangements to write and rank. */
  alternatives: z.number().int().min(1).max(3).default(1),
});
export type Controls = z.infer<typeof Controls>;

/** One concrete arrangement direction: what the arranger is asked to write. */
export const Direction = z.object({
  name: z.string(),
  style: z.string(),
  flair: z.enum(FLAIRS),
  difficulty: z.enum(DIFFICULTIES),
  reharm: z.enum(REHARM_LEVELS),
  fidelity: z.enum(FIDELITIES),
  /** Why this direction suits this particular song (1–2 sentences, specific). */
  concept: z.string(),
  /** The few devices to use and where (e.g. "tritone sub into the last cadence", "harmonics on the hook"). */
  devices: z.array(z.string()),
});
export type Direction = z.infer<typeof Direction>;

export const ArrangementPlan = z.object({
  analysis: z.object({
    mood: z.string(),
    melody: z.string(),
    harmony: z.string(),
    rhythm: z.string(),
    hooks: z.string(),
  }),
  directions: z.array(Direction),
});
export type ArrangementPlan = z.infer<typeof ArrangementPlan>;

const isAuto = (v: string) => v === AUTO;

/** True when the user fixed everything for a single arrangement, so no planning call is needed. */
export function needsPlan(c: Controls): boolean {
  return c.alternatives > 1 || [c.style, c.flair, c.difficulty, c.reharm, c.fidelity].some(isAuto);
}

/** A direction made purely from the user's controls (no planner). */
export function directionFromControls(c: Controls): Direction {
  return {
    name: c.style,
    style: c.style,
    flair: isAuto(c.flair) ? "expressive" : (c.flair as Flair),
    difficulty: isAuto(c.difficulty) ? "intermediate" : (c.difficulty as Direction["difficulty"]),
    reharm: isAuto(c.reharm) ? "light" : (c.reharm as ReharmLevel),
    fidelity: isAuto(c.fidelity) ? "exact" : (c.fidelity as Fidelity),
    concept: "",
    devices: [],
  };
}

/** User choices always win over the planner: overwrite any field the user set explicitly. */
export function lockDirection(d: Direction, c: Controls): Direction {
  return {
    ...d,
    ...(!isAuto(c.style) && { style: c.style }),
    ...(!isAuto(c.flair) && { flair: c.flair as Flair }),
    ...(!isAuto(c.difficulty) && { difficulty: c.difficulty as Direction["difficulty"] }),
    ...(!isAuto(c.reharm) && { reharm: c.reharm as ReharmLevel }),
    ...(!isAuto(c.fidelity) && { fidelity: c.fidelity as Fidelity }),
  };
}

export function validatePlan(plan: ArrangementPlan, want: number): Issue[] {
  const issues: Issue[] = [];
  if (plan.directions.length !== want)
    issues.push({ level: "error", where: "directions", message: `return exactly ${want} directions (got ${plan.directions.length})` });
  const names = plan.directions.map((d) => `${d.style}|${d.flair}|${d.reharm}`);
  if (new Set(names).size !== names.length)
    issues.push({ level: "error", where: "directions", message: "directions must differ in style, flair or reharmonization" });
  plan.directions.forEach((d, i) => {
    if (!d.concept.trim()) issues.push({ level: "error", where: `direction ${i + 1}`, message: "concept is empty" });
  });
  return issues;
}

export const PLAN_SYSTEM = `You are the music director of a solo-guitar arranging studio. Before anything is written, you study the song and decide HOW it should be arranged for one guitar.

1. Analyse the song as a musician: mood/character, melody (range, contour, rhythm, where the hooks are), harmony (key, functions, how static or busy), rhythm/groove. Be specific to this song; no generic filler.
2. Propose arrangement directions that genuinely fit THIS song. Judge fit by: does the style serve the melody's character and tempo? does the harmony invite reharmonization or is the song's identity in its plain chords? does the groove suit percussive treatment or would that bury a lyrical line? is it playable at the chosen difficulty?
   - Prefer restraint: pick only the devices that serve the song (e.g. harmonics where the melody hangs on a long note, a walking bass only if the tune swings). Never list techniques just to show them off.
   - When several directions are requested they must be clearly different (e.g. "intimate & faithful", "reharmonized jazz ballad", "groove-driven percussive"), each a valid way to play this song.
   - Respect every field the player fixed; they are listed as LOCKED. The player's free-text direction, if any, is the strongest signal.
3. For each direction set: name (2–4 evocative words), style (a short style label, at most 6 words, e.g. "Hymn-like fingerstyle", "Bossa nova chord-melody"; details belong in concept and devices), flair (clean | expressive | showstopper), difficulty, reharm (none | light | moderate | bold), fidelity (exact | embellished | free — how literally the melody is kept), concept (1–2 sentences on why it fits this song), devices (2–5 concrete devices with where they go).
   - Recognizability first: when the player names an existing song and gives no direction, the first direction must be a faithful one (reharm "none" or "light", fidelity "exact", the song's own groove and tempo feel). Bold reharmonization or a genre change only when the player asks for it or as a clearly labelled extra alternative.
   - Default fidelity is "exact" when the melody is the point; "embellished" lets the arranger add grace notes and shift notes by up to half a beat; "free" is only for an explicit request for a loose re-imagining.`;

export function planPrompt(c: Controls, want: number, tune?: Tune): string {
  const locked = (["style", "flair", "difficulty", "reharm", "fidelity"] as const)
    .filter((k) => !isAuto(c[k]))
    .map((k) => `${k} = ${c[k]}`);
  const lines = [
    `Player's direction: ${c.request.trim() || "(none — choose what suits the song)"}`,
    `Texture: ${c.texture} (solo guitar${c.texture === "fingerstyle" ? ", melody + bass + inner voices in one part" : ", chord comping"})`,
    `LOCKED by the player: ${locked.length ? locked.join(", ") : "nothing — decide everything"}`,
    `Fretboard preference: ${c.position}`,
    `Return exactly ${want} direction${want > 1 ? "s" : ""}.`,
  ];
  if (tune) {
    lines.push(
      "",
      `IMPORTED TUNE "${tune.title}", ${tune.timeSignature.numerator}/${tune.timeSignature.denominator}, ${tune.tempo} bpm, ${tune.bars.length} bars.`,
      "Notation: NOTE@start(duration) in quarter beats from the bar start; brackets hold source chords, accompaniment pitch classes and bass notes.",
      tuneToText(tune),
    );
  }
  return lines.join("\n");
}
