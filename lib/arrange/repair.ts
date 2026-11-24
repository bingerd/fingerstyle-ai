import { z } from "zod";
import { Bar, type Song } from "@/lib/ir/schema";
import { errorsOnly, formatIssues, validateAgainstTune, validateBar, validateSpeed, type Issue } from "@/lib/theory/validate";
import { midiName, type Tune } from "@/lib/tune/tune";
import type { Fidelity } from "./plan";

/**
 * Targeted repair: instead of asking the model to rewrite the whole arrangement when a few bars
 * are wrong, send back only the broken bars and splice the fixes in. A full rewrite of 16 bars of
 * fingerstyle tab takes minutes; a few bars take well under a minute.
 */
export const BarFixes = z.object({
  bars: z.array(z.object({ index: z.number().int(), bar: Bar })),
});
export type BarFixes = z.infer<typeof BarFixes>;

type Located = { index: number; where: string; bar: Song["sections"][number]["bars"][number] };

function locate(song: Song): Located[] {
  return song.sections.flatMap((s) => s.bars.map((bar, i) => ({ bar, where: `${s.name} bar ${i + 1}` }))).map((b, index) => ({ ...b, index }));
}

/** Errors split into those that live inside one bar and song-level ones (need a full rewrite). */
export function barErrors(song: Song, opts: { tune?: Tune; fidelity: Fidelity; texture: Song["texture"] }) {
  const global: Issue[] = [];
  const perBar = new Map<number, Issue[]>();
  const bars = locate(song);
  if (song.texture !== opts.texture) global.push({ level: "error", where: "song", message: `texture must be "${opts.texture}"` });
  if (song.capo < 0 || song.capo > 9) global.push({ level: "error", where: "capo", message: "capo must be 0–9" });
  if (opts.tune && bars.length !== opts.tune.bars.length)
    global.push({ level: "error", where: "song", message: `arrangement has ${bars.length} bars, the tune has ${opts.tune.bars.length}` });
  for (const b of bars) {
    const issues = errorsOnly([
      ...validateBar(song, b.bar, b.where),
      ...validateSpeed(b.bar.beats, song.tempo, b.where),
      ...(opts.tune && opts.fidelity !== "free" && b.index < opts.tune.bars.length ? validateAgainstTune(song, opts.tune, b.index, opts.fidelity) : []),
    ]);
    if (issues.length) perBar.set(b.index, issues);
  }
  return { global, perBar };
}

/** Replace bars by global index; chord ids that would collide are renamed. */
export function spliceBars(song: Song, fixes: BarFixes["bars"]): Song {
  const byIndex = new Map(fixes.map((f) => [f.index, f.bar]));
  let i = 0;
  const next: Song = {
    ...song,
    sections: song.sections.map((s) => ({ ...s, bars: s.bars.map((b) => byIndex.get(i++) ?? b) })),
  };
  const seen = new Set<string>();
  let n = 0;
  for (const s of next.sections)
    for (const b of s.bars)
      b.chords = b.chords.map((c) => {
        let id = c.id;
        while (seen.has(id)) id = `r${++n}`;
        seen.add(id);
        return id === c.id ? c : { ...c, id };
      });
  return next;
}

export function repairPrompt(song: Song, perBar: Map<number, Issue[]>, tune?: Tune): string {
  const bars = locate(song);
  const neighbours = new Set<number>();
  for (const i of perBar.keys()) for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < bars.length) neighbours.add(j);
  const lines = [
    `Arrangement "${song.title}" — ${song.style}, key ${song.key}, ${song.timeSignature.numerator}/${song.timeSignature.denominator}, tuning ${song.tuning}, capo ${song.capo}, transpose ${song.transpose}, texture ${song.texture}, difficulty ${song.difficulty}.`,
    "",
    "A deterministic checker found errors in some bars. Fix ONLY those bars and return them as {bars: [{index, bar}]} (index = 0-based bar number across the whole song).",
    "Keep each bar's musical idea, chord symbols, chord ids and everything that was fine; change as little as possible. Stay consistent with the neighbouring bars.",
    "",
    "Context (the broken bars and their neighbours, as JSON):",
    ...[...neighbours].sort((a, b) => a - b).map((i) => `bar index ${i} (${bars[i].where})${perBar.has(i) ? " [BROKEN]" : ""}: ${JSON.stringify(bars[i].bar)}`),
    "",
    "Errors to fix:",
    ...[...perBar.entries()].map(([i, issues]) => `bar index ${i}:\n${formatIssues(issues)}`),
  ];
  if (tune) {
    lines.push("", "Melody of the imported tune for these bars (NOTE@start(duration) in quarter beats; add transpose semitones):");
    for (const i of perBar.keys()) {
      const tb = tune.bars[i];
      if (tb) lines.push(`bar index ${i}: ${tb.melody.map((n) => `${midiName(n.midi)}@${n.start}(${n.dur})`).join(" ") || "rest"}`);
    }
  }
  return lines.join("\n");
}
