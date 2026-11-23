import { z } from "zod";

/**
 * An imported tune: the ground truth an arrangement must follow.
 * Times are in quarter-note beats relative to the start of each bar, quantized to 16ths.
 */
export const TuneNote = z.object({ start: z.number(), dur: z.number(), midi: z.number().int() });
export type TuneNote = z.infer<typeof TuneNote>;

export const TuneBar = z.object({
  melody: z.array(TuneNote),
  /** Chord symbols found in the source file (Guitar Pro chord names), if any. */
  chords: z.array(z.string()),
  /** Pitch classes (0–11) sounding in the other tracks during this bar, low to high by count. */
  accompaniment: z.array(z.number().int()),
  /** Lowest accompaniment note per half-bar (MIDI), a hint for the bass line. */
  bass: z.array(z.number().int()),
});
export type TuneBar = z.infer<typeof TuneBar>;

export const Tune = z.object({
  title: z.string(),
  tempo: z.number(),
  timeSignature: z.object({ numerator: z.number().int(), denominator: z.number().int() }),
  bars: z.array(TuneBar),
});
export type Tune = z.infer<typeof Tune>;

/** Neutral note-event format both importers produce before bar slicing. */
export type RawTrack = { name: string; notes: { tick: number; durTicks: number; midi: number }[] };
export type RawScore = {
  title: string;
  tempo: number;
  ppq: number;
  timeSignature: { numerator: number; denominator: number };
  tracks: RawTrack[];
  /** Optional chord names by tick (Guitar Pro). */
  chords?: { tick: number; name: string }[];
};

const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const midiName = (m: number) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

const q16 = (beats: number) => Math.round(beats * 4) / 4;

/** Guess the melody track: most notes in the upper register, ignoring drums. */
export function guessMelodyTrack(raw: RawScore): number {
  let best = 0, bestScore = -Infinity;
  raw.tracks.forEach((t, i) => {
    if (!t.notes.length || /drum|perc/i.test(t.name)) return;
    const avg = t.notes.reduce((n, x) => n + x.midi, 0) / t.notes.length;
    const score = avg + Math.log(t.notes.length) * 3;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/** Slice a raw score into bars, taking the skyline (highest note per onset) of the melody track. */
export function toTune(raw: RawScore, melodyTrack: number, fromBar = 0, barCount = 16): Tune {
  const beatsPerBar = raw.timeSignature.numerator * (4 / raw.timeSignature.denominator);
  const barTicks = beatsPerBar * raw.ppq;
  const firstTick = fromBar * barTicks;
  const lastTick = firstTick + barCount * barTicks;

  const bars: TuneBar[] = Array.from({ length: barCount }, () => ({ melody: [], chords: [], accompaniment: [], bass: [] }));

  // Melody skyline.
  const onsets = new Map<number, { dur: number; midi: number }>();
  for (const n of raw.tracks[melodyTrack]?.notes ?? []) {
    if (n.tick < firstTick || n.tick >= lastTick) continue;
    const t = q16((n.tick - firstTick) / raw.ppq);
    const prev = onsets.get(t);
    if (!prev || n.midi > prev.midi) onsets.set(t, { dur: Math.max(0.25, q16(n.durTicks / raw.ppq)), midi: n.midi });
  }
  const sorted = [...onsets.entries()].sort((a, b) => a[0] - b[0]);
  sorted.forEach(([t, n], i) => {
    const bar = Math.floor(t / beatsPerBar + 1e-9);
    if (bar >= barCount) return;
    const start = q16(t - bar * beatsPerBar);
    const next = sorted[i + 1]?.[0] ?? Infinity;
    const barEnd = (bar + 1) * beatsPerBar;
    const dur = q16(Math.min(n.dur, next - t, barEnd - t));
    if (dur > 0) bars[bar].melody.push({ start, dur, midi: n.midi });
  });

  // Accompaniment pitch classes and bass hints from all other tracks.
  const counts = bars.map(() => new Map<number, number>());
  raw.tracks.forEach((track, ti) => {
    if (ti === melodyTrack || /drum|perc/i.test(track.name)) return;
    for (const n of track.notes) {
      if (n.tick < firstTick || n.tick >= lastTick) continue;
      const beat = (n.tick - firstTick) / raw.ppq;
      const bar = Math.floor(beat / beatsPerBar);
      const c = counts[bar];
      c.set(n.midi % 12, (c.get(n.midi % 12) ?? 0) + 1);
      const half = (beat - bar * beatsPerBar) < beatsPerBar / 2 ? 0 : 1;
      const cur = bars[bar].bass[half];
      if (cur === undefined || n.midi < cur) bars[bar].bass[half] = n.midi;
    }
  });
  bars.forEach((b, i) => {
    b.accompaniment = [...counts[i].entries()].sort((a, b) => b[1] - a[1]).map(([pc]) => pc);
    b.bass = b.bass.filter((x) => x !== undefined);
  });

  for (const c of raw.chords ?? []) {
    if (c.tick < firstTick || c.tick >= lastTick) continue;
    const bar = Math.floor((c.tick - firstTick) / barTicks);
    if (!bars[bar].chords.includes(c.name)) bars[bar].chords.push(c.name);
  }

  return { title: raw.title, tempo: Math.round(raw.tempo), timeSignature: raw.timeSignature, bars };
}

/** Compact text rendering of a tune for prompts. */
export function tuneToText(tune: Tune): string {
  const pc = (p: number) => NOTE_NAMES[p];
  return tune.bars
    .map((b, i) => {
      const mel = b.melody.length ? b.melody.map((n) => `${midiName(n.midi)}@${n.start}(${n.dur})`).join(" ") : "rest";
      const extra = [
        b.chords.length ? `chords in source: ${b.chords.join(" ")}` : "",
        b.accompaniment.length ? `accompaniment pcs: ${b.accompaniment.slice(0, 6).map(pc).join(" ")}` : "",
        b.bass.length ? `bass: ${b.bass.map(midiName).join(" ")}` : "",
      ].filter(Boolean).join("; ");
      return `bar ${i + 1}: ${mel}${extra ? `   [${extra}]` : ""}`;
    })
    .join("\n");
}
