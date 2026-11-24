import { z } from "zod";
import { Bar, Song, TasteNote } from "@/lib/ir/schema";
import { errorsOnly, validateAgainstTune, validateBar, validateSpeed, type Issue } from "@/lib/theory/validate";
import { tuneToText, type Tune } from "@/lib/tune/tune";
import type { Direction } from "./plan";

/**
 * Full-length pieces: a blueprint call plans the form and a "style bible" (tuning, groove cell,
 * hook, chord plan per section); then every section is written in parallel as a small call and
 * stitched together. Smaller outputs are faster, stay under output limits, and fail locally.
 */
export const Blueprint = z.object({
  title: z.string(),
  summary: z.string(),
  key: z.string(),
  tempo: z.number().int(),
  timeSignature: z.object({ numerator: z.number().int(), denominator: z.number().int() }),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  tuning: z.enum(["standard", "drop-d", "dadgad", "open-d", "open-g", "half-step-down"]),
  capo: z.number().int(),
  transpose: z.number().int(),
  /** The 1–2 bar groove cell every section varies (bass pattern, slap/knock placement, inner-voice rhythm). */
  groove: z.string(),
  /** The signature hook: what it is, where it appears, which technique makes it memorable. */
  hook: z.string(),
  sections: z.array(z.object({
    name: z.string(),
    bars: z.number().int(),
    /** Its job in the form: intro, statement, build, contrast, climax, outro… */
    role: z.string(),
    /** Texture, techniques and dynamics for this section, concretely. */
    plan: z.string(),
    /** One chord symbol (or "|"-separated chords) per bar, e.g. "Em | Cmaj7 | G | D/F#". */
    chords: z.string(),
  })),
  tasteNotes: z.array(TasteNote),
});
export type Blueprint = z.infer<typeof Blueprint>;

export const SectionPart = z.object({ bars: z.array(Bar), note: z.string() });
export type SectionPart = z.infer<typeof SectionPart>;

export function validateBlueprint(bp: Blueprint, want: { exactBars?: number; minBars: number; maxBars: number }): Issue[] {
  const issues: Issue[] = [];
  const err = (where: string, message: string) => issues.push({ level: "error", where, message });
  const total = bp.sections.reduce((n, s) => n + s.bars, 0);
  if (want.exactBars !== undefined && total !== want.exactBars) err("sections", `sections must add up to exactly ${want.exactBars} bars (got ${total})`);
  else if (want.exactBars === undefined && (total < want.minBars || total > want.maxBars)) err("sections", `sections must add up to ${want.minBars}–${want.maxBars} bars (got ${total})`);
  if (bp.sections.length < 2) err("sections", "plan at least 2 sections");
  bp.sections.forEach((s, i) => { if (s.bars < 1 || s.bars > 16) err(`section ${i + 1}`, "each section needs 1–16 bars"); });
  if (bp.capo < 0 || bp.capo > 9) err("capo", "capo must be 0–9");
  if (![2, 4, 8].includes(bp.timeSignature.denominator)) err("timeSignature", "denominator must be 2, 4 or 8");
  return issues;
}

export function blueprintPrompt(opts: { request: string; direction: Direction; position: string; tune?: Tune; minBars: number; maxBars: number }): string {
  const d = opts.direction;
  const lines = [
    `Plan a complete solo fingerstyle guitar piece. Do NOT write tab yet; write the blueprint every section will follow.`,
    `Request: ${opts.request || (opts.tune ? "Arrange this tune." : "(open)")}`,
    `Direction: ${d.name}${d.concept ? ` — ${d.concept}` : ""}`,
    `Style: ${d.style} · flair ${d.flair} · difficulty ${d.difficulty} · reharmonization ${d.reharm} · melody ${d.fidelity}`,
    ...(d.devices.length ? [`Devices to use where they serve the music: ${d.devices.join("; ")}`] : []),
    `Fretboard preference: ${opts.position}`,
    opts.tune
      ? `Form: exactly ${opts.tune.bars.length} bars, following the tune's own phrases (group its bars into sections).`
      : `Form: ${opts.minBars}–${opts.maxBars} bars, e.g. Intro (2–4) · A · A′ (varied) · B (contrast) · Climax (fullest texture, signature moves) · Outro/ending (2–4).`,
    "Make it a finished, filmable piece: one memorable hook (state where it returns), a groove cell that recurs with variation, a dynamic arc that peaks in the climax, and a big ending.",
    "title: the name players see, e.g. \"Song Name: Style\" (never words like blueprint or plan).",
    "chords: one entry per bar separated by '|', using standard symbols. The bible (tuning, capo, transpose, key, tempo, groove, hook) is binding for every section.",
  ];
  if (opts.tune) lines.push("", `IMPORTED TUNE "${opts.tune.title}" (NOTE@start(duration), quarter beats):`, tuneToText(opts.tune));
  return lines.join("\n");
}

export function sectionPrompt(opts: { bp: Blueprint; index: number; startBar: number; direction: Direction; tune?: Tune; fidelityRule: string }): string {
  const { bp, index, startBar, tune } = opts;
  const sec = bp.sections[index];
  let bar = 0;
  const form = bp.sections.map((s, i) => {
    const line = `${i === index ? "→ " : "  "}${s.name} (bars ${bar + 1}–${bar + s.bars}, ${s.role}): ${s.plan} | chords: ${s.chords}`;
    bar += s.bars;
    return line;
  });
  const prevChords = index > 0 ? bp.sections[index - 1].chords.split("|").map((c) => c.trim()).filter(Boolean).at(-1) : null;
  const nextChord = index < bp.sections.length - 1 ? bp.sections[index + 1].chords.split("|")[0]?.trim() : null;
  const lines = [
    `Write ONE section of a solo fingerstyle piece as tab (texture "fingerstyle"). Other sections are written in parallel from the same blueprint, so follow the bible exactly.`,
    `Piece: "${bp.title}" — ${opts.direction.style}, flair ${opts.direction.flair}, difficulty ${bp.difficulty}.`,
    `Bible: key ${bp.key}, ${bp.timeSignature.numerator}/${bp.timeSignature.denominator}, tempo ${bp.tempo}, tuning ${bp.tuning}, capo ${bp.capo}, transpose ${bp.transpose}.`,
    `Groove cell (recurs with variation): ${bp.groove}`,
    `Hook: ${bp.hook}`,
    "",
    "Form (→ = the section you write):",
    ...form,
    "",
    `Write "${sec.name}": exactly ${sec.bars} bars, following its plan and chord plan.`,
    prevChords ? `It follows a bar on ${prevChords}; make the first bar connect smoothly.` : "It opens the piece.",
    nextChord ? `It leads into ${nextChord}; make the last bar set that up.` : "It ends the piece: make the ending land (ringing chord, harmonic chime or final hit).",
    `Chord ids: "s${index + 1}c1", "s${index + 1}c2", … (unique within this section).`,
    "note: one or two sentences on what to notice in this section.",
  ];
  if (tune) {
    const slice: Tune = { ...tune, bars: tune.bars.slice(startBar, startBar + sec.bars) };
    lines.push("", `Melody for these bars (tune bars ${startBar + 1}–${startBar + sec.bars}; add transpose ${bp.transpose} semitones):`, tuneToText(slice), opts.fidelityRule);
  }
  return lines.join("\n");
}

/** Errors inside one section; the tune slice is checked against just these bars. */
export function validateSection(part: SectionPart, opts: { bp: Blueprint; index: number; startBar: number; tune?: Tune; fidelity: Direction["fidelity"]; style: string }): Issue[] {
  const sec = opts.bp.sections[opts.index];
  const issues: Issue[] = [];
  if (part.bars.length !== sec.bars) issues.push({ level: "error", where: sec.name, message: `write exactly ${sec.bars} bars (got ${part.bars.length})` });
  const song = assemble(opts.bp, [{ ...part }], opts.style, [{ ...sec, bars: part.bars.length }]);
  song.sections[0].bars.forEach((b, i) => {
    const where = `${sec.name} bar ${i + 1}`;
    issues.push(...validateBar(song, b, where), ...validateSpeed(b.beats, song.tempo, where));
  });
  if (opts.tune && opts.fidelity !== "free") {
    const slice: Tune = { ...opts.tune, bars: opts.tune.bars.slice(opts.startBar, opts.startBar + sec.bars) };
    issues.push(...validateAgainstTune(song, slice, undefined, opts.fidelity));
  }
  return errorsOnly(issues);
}

/** Stitch blueprint + written sections into one Song. */
export function assemble(bp: Blueprint, parts: SectionPart[], style: string, sections = bp.sections): Song {
  return {
    title: bp.title,
    style,
    key: bp.key,
    tempo: bp.tempo,
    timeSignature: bp.timeSignature,
    difficulty: bp.difficulty,
    texture: "fingerstyle",
    tuning: bp.tuning,
    capo: bp.capo,
    transpose: bp.transpose,
    summary: bp.summary,
    sections: parts.map((p, i) => ({ name: sections[i].name, bars: p.bars, note: p.note })),
    tasteNotes: bp.tasteNotes,
  };
}

export const sectionStarts = (bp: Blueprint) => bp.sections.reduce<number[]>((acc, s, i) => [...acc, i ? acc[i - 1] + bp.sections[i - 1].bars : 0], []);

export { Song };
