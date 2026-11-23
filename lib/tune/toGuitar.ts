import type { Song, TabBeat, TabNote } from "@/lib/ir/schema";
import { TUNINGS } from "@/lib/theory/validate";
import type { RawScore } from "./tune";

/**
 * Deterministic MIDI → guitar tab: no model involved.
 *  1. Quantize onsets per beat to the best of three grids (16ths, 8th-triplets, 32nds).
 *  2. Choose strings/frets for every onset with a Viterbi search that keeps chord shapes
 *     compact (span ≤ 4), prefers low positions and open strings, keeps the melody on the
 *     treble strings, and minimises hand shifts and cutting off still-ringing notes.
 *  3. Write the result as Song IR bars, so it renders and plays like any arrangement.
 */

/** Time unit: 1/24 of a quarter note (covers 32nds = 3 and 8th-triplets = 8). */
const Q = 24;
const MAX_FRET = 17;

/** [length in units, value, dotted, triplet], longest first. */
const VALUES: [number, TabBeat["value"], boolean, boolean][] = [
  [96, 1, false, false], [72, 2, true, false], [48, 2, false, false], [36, 4, true, false], [24, 4, false, false],
  [18, 8, true, false], [16, 4, false, true], [12, 8, false, false], [9, 16, true, false], [8, 8, false, true],
  [6, 16, false, false], [4, 16, false, true], [3, 32, false, false],
];

type Val = [TabBeat["value"], boolean, boolean];

/** Exact split of a gap into note values (shortest list), or null if impossible. */
function decomposeExact(units: number, memo = new Map<number, Val[] | null>()): Val[] | null {
  if (units === 0) return [];
  if (memo.has(units)) return memo.get(units)!;
  let best: Val[] | null = null;
  for (const [u, v, d, t] of VALUES) {
    if (u > units) continue;
    const rest = decomposeExact(units - u, memo);
    if (rest && (!best || rest.length + 1 < best.length)) best = [[v, d, t], ...rest];
  }
  memo.set(units, best);
  return best;
}

/**
 * Split a gap that starts at `from` into note values: the first carries the notes, the rest are rests.
 * Gaps mixing triplet and straight subdivisions are split at quarter-note boundaries first.
 */
function decompose(from: number, units: number): Val[] {
  const exact = decomposeExact(units);
  if (exact) return exact;
  const out: Val[] = [];
  let pos = from;
  const end = from + units;
  while (pos < end) {
    const next = Math.min(end, (Math.floor(pos / Q) + 1) * Q);
    out.push(...(decomposeExact(next - pos) ?? []));
    pos = next;
  }
  return out;
}

/** Guess the tuning from ClassTab's free-text tuning line. */
export function tuningFromText(text: string): Song["tuning"] {
  const t = text.toUpperCase().replace(/[^A-G#]/g, "");
  if (t.startsWith("DADGAD")) return "dadgad";
  if (t.startsWith("DADF#AD")) return "open-d";
  if (t.startsWith("DGDGBD")) return "open-g";
  if (t.startsWith("DADGBE")) return "drop-d";
  return "standard";
}

type Cand = { notes: TabNote[]; cost: number; pos: number | null; strings: Map<number, number> };

function candidates(pitches: number[], open: number[]): Cand[] {
  const sorted = [...new Set(pitches)].sort((a, b) => b - a);
  // A guitar has six strings: keep melody (top) and bass (bottom) first.
  const keep = sorted.length > 6 ? [...sorted.slice(0, 5), sorted.at(-1)!] : sorted;
  const out: Cand[] = [];
  const assign = (i: number, used: Map<number, number>) => {
    if (out.length > 400) return;
    if (i === keep.length) {
      const notes: TabNote[] = [...used.entries()].map(([string, fret]) => ({ string, fret, technique: "none" as const }));
      const fretted = notes.filter((n) => n.fret > 0).map((n) => n.fret);
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
      if (span > 5) return;
      const pos = fretted.length ? Math.min(...fretted) : null;
      const topString = [...used.entries()].find(([s, f]) => open[6 - s] + f === keep[0])?.[0] ?? 1;
      const cost =
        Math.max(0, span - 3) * 3 + // stretches
        (pos ?? 0) * 0.12 + // lower positions are easier
        -0.25 * notes.filter((n) => n.fret === 0).length + // open strings ring
        (keep.length > 1 && topString > 3 ? 1.5 : 0); // melody on the treble strings
      out.push({ notes, cost, pos, strings: new Map(used) });
      return;
    }
    for (let s = 1; s <= 6; s++) {
      if (used.has(s)) continue;
      const fret = keep[i] - open[6 - s];
      if (fret < 0 || fret > MAX_FRET) continue;
      // Higher pitches must sit on higher (lower-numbered) strings than already-placed lower ones.
      if ([...used.entries()].some(([us, uf]) => (us < s) !== (open[6 - us] + uf > keep[i]))) continue;
      used.set(s, fret);
      assign(i + 1, used);
      used.delete(s);
    }
  };
  assign(0, new Map());
  return out.sort((a, b) => a.cost - b.cost).slice(0, 24);
}

export function guitarFromMidi(raw: RawScore, opts: { title: string; composer?: string; tuning?: Song["tuning"] }): Song {
  const notes = raw.tracks.filter((t) => !/drum|perc/i.test(t.name)).flatMap((t) => t.notes);
  if (!notes.length) throw new Error("This MIDI file has no notes to play.");
  const minPitch = Math.min(...notes.map((n) => n.midi));
  const tuning = opts.tuning ?? (minPitch < 40 && minPitch >= 38 ? "drop-d" : "standard");
  const open = TUNINGS[tuning];
  const lowest = open[0], highest = open[5] + MAX_FRET;
  const fit = (m: number) => { while (m < lowest) m += 12; while (m > highest) m -= 12; return m; };

  const unitTicks = raw.ppq / Q;
  const beatUnits = (4 / raw.timeSignature.denominator) * Q;
  const barUnits = raw.timeSignature.numerator * beatUnits;

  // 1. Quantize onsets beat by beat to the grid that fits best.
  const byBeat = new Map<number, number[]>();
  for (const n of notes) {
    const u = n.tick / unitTicks;
    const beat = Math.floor(u / Q);
    if (!byBeat.has(beat)) byBeat.set(beat, []);
    byBeat.get(beat)!.push(u);
  }
  const snap = new Map<number, number>(); // raw unit (rounded) → quantized unit
  for (const [beat, us] of byBeat) {
    let best = { grid: 6, err: Infinity };
    for (const [grid, penalty] of [[6, 0], [8, 0.6], [3, 0.9]] as const) {
      const err = us.reduce((e, u) => e + Math.abs(u - Math.round(u / grid) * grid), 0) / us.length + penalty;
      if (err < best.err) best = { grid, err };
    }
    for (const u of us) snap.set(Math.round(u * 1000), Math.round(u / best.grid) * best.grid);
    void beat;
  }
  const onsets = new Map<number, { pitches: Set<number>; end: number }>();
  for (const n of notes) {
    const u = snap.get(Math.round((n.tick / unitTicks) * 1000))!;
    const o = onsets.get(u) ?? { pitches: new Set<number>(), end: 0 };
    o.pitches.add(fit(n.midi));
    o.end = Math.max(o.end, u + Math.max(3, Math.round(n.durTicks / unitTicks)));
    onsets.set(u, o);
  }
  const times = [...onsets.keys()].sort((a, b) => a - b);

  // 2. Viterbi over onsets.
  const layers = times.map((t) => candidates([...onsets.get(t)!.pitches], open));
  const score: number[][] = [];
  const back: number[][] = [];
  layers.forEach((cands, i) => {
    if (!cands.length) {
      // Unplayable cluster: fall back to the top note alone.
      const top = Math.max(...onsets.get(times[i])!.pitches);
      cands.push(...candidates([top], open));
      layers[i] = cands;
    }
    score[i] = [];
    back[i] = [];
    cands.forEach((c, ci) => {
      if (i === 0) { score[i][ci] = c.cost; back[i][ci] = -1; return; }
      let best = Infinity, arg = 0;
      const prevEnd = onsets.get(times[i - 1])!.end;
      layers[i - 1].forEach((p, pi) => {
        let move = 0;
        if (p.pos !== null && c.pos !== null) move = Math.abs(p.pos - c.pos) * 0.6;
        // Re-plucking a string that is still ringing cuts it off.
        const cut = prevEnd > times[i] ? [...c.strings.keys()].filter((s) => p.strings.has(s) && p.strings.get(s) !== c.strings.get(s)).length * 0.8 : 0;
        const total = score[i - 1][pi] + move + cut;
        if (total < best) { best = total; arg = pi; }
      });
      score[i][ci] = best + c.cost;
      back[i][ci] = arg;
    });
  });
  const chosen: Cand[] = new Array(times.length);
  if (times.length) {
    let ci = score.at(-1)!.indexOf(Math.min(...score.at(-1)!));
    for (let i = times.length - 1; i >= 0; i--) {
      chosen[i] = layers[i][ci];
      ci = back[i][ci];
    }
  }

  // 3. Bars of tab beats.
  const lastEnd = Math.max(0, ...[...onsets.values()].map((o) => o.end));
  const barCount = Math.max(1, Math.ceil(lastEnd / barUnits));
  const bars: Song["sections"][number]["bars"] = [];
  let k = 0;
  for (let b = 0; b < barCount; b++) {
    const start = b * barUnits, end = start + barUnits;
    const beats: TabBeat[] = [];
    let pos = start;
    const push = (len: number, notesHere: TabNote[]) => {
      decompose(pos, len).forEach(([value, dotted, triplet], i) =>
        beats.push({ value, dotted, triplet, percussion: "none", notes: i === 0 ? notesHere : [], chord: "" }));
    };
    while (k < times.length && times[k] < end) {
      if (times[k] > pos) push(times[k] - pos, []);
      const next = Math.min(times[k + 1] ?? end, end);
      push(next - times[k], chosen[k].notes.sort((x, y) => x.string - y.string));
      pos = next;
      k++;
    }
    if (pos < end) push(end - pos, []);
    bars.push({ chords: [], beats });
  }

  const sections = [];
  for (let i = 0; i < bars.length; i += 8) sections.push({ name: `m. ${i + 1}`, note: "", bars: bars.slice(i, i + 8) });
  return {
    title: opts.title,
    style: opts.composer ? `${opts.composer} · ClassTab MIDI` : "ClassTab MIDI",
    key: "",
    tempo: Math.max(20, Math.round(raw.tempo)),
    timeSignature: raw.timeSignature,
    difficulty: "intermediate",
    texture: "fingerstyle",
    tuning,
    capo: 0,
    transpose: 0,
    summary: "Tab computed from the piece's MIDI file: string and fret choices are generated automatically, not the transcriber's fingering.",
    sections,
    tasteNotes: [],
  };
}
