import type { Song, TabNote } from "@/lib/ir/schema";

/**
 * Deterministic fingerings for explicit tab.
 *  Left hand (1 index … 4 pinky, 0 = open/none): a Viterbi search over beats. Within a beat,
 *  fingers rise with frets; one finger may barre a fret across strings. Costs favour "one finger
 *  per fret" spacing, few hand shifts, and keeping a finger on a note that is repeated (guide finger).
 *  Right hand (p i m a): thumb takes the bass strings, i/m/a the treble strings in order, and
 *  repeated single treble notes alternate i–m. Legato/tapped notes aren't plucked, so they get none.
 */
export type RightFinger = "p" | "i" | "m" | "a";
export type NoteFingering = { lh: number; rh: RightFinger | null };
/** Key: `${barIndex}:${beatIndex}:${string}` (bar index across the whole song). */
export type Fingerings = Map<string, NoteFingering>;

export const fingeringKey = (bar: number, beat: number, string: number) => `${bar}:${beat}:${string}`;

type Fretted = { string: number; fret: number };
type Cand = { fingers: Map<number, number>; pos: number; cost: number };

const LEFT_SKIP = new Set<TabNote["technique"]>(["dead", "tap", "harmonic"]);

/** All monotone finger assignments for the fretted notes of one beat. */
function leftCandidates(notes: Fretted[]): Cand[] {
  if (!notes.length) return [{ fingers: new Map(), pos: -1, cost: 0 }];
  const sorted = [...notes].sort((a, b) => a.fret - b.fret || b.string - a.string);
  const out: Cand[] = [];
  const assign = (i: number, acc: number[]) => {
    if (i === sorted.length) {
      let cost = 0;
      const barres = new Map<number, number[]>();
      for (let k = 0; k < sorted.length; k++) {
        const f = acc[k];
        barres.set(f, [...(barres.get(f) ?? []), sorted[k].fret]);
      }
      for (const [f, frets] of barres) {
        if (new Set(frets).size > 1) return; // one finger can't hold two frets
        if (frets.length > 1) {
          const strings = sorted.filter((_, k) => acc[k] === f).map((x) => x.string);
          // Only the index lies flat across non-adjacent strings; other fingers mini-barre neighbours.
          if (f !== 1 && Math.max(...strings) - Math.min(...strings) > 1) return;
          cost += f === 1 ? 0.6 : 1.2;
        }
      }
      for (let k = 1; k < sorted.length; k++) {
        const df = acc[k] - acc[k - 1], dfret = sorted[k].fret - sorted[k - 1].fret;
        cost += Math.abs(df - dfret) * 0.8; // one finger per fret
      }
      const pos = Math.round(sorted.reduce((n, x, k) => n + x.fret - acc[k] + 1, 0) / sorted.length);
      if (sorted.at(-1)!.fret - pos > 4) cost += 3; // stretch beyond the hand frame
      cost += acc.filter((f) => f === 4).length * 0.15; // pinky is weakest
      out.push({ fingers: new Map(sorted.map((x, k) => [x.string, acc[k]])), pos, cost });
      return;
    }
    const prev = acc[i - 1];
    const sameFret = i > 0 && sorted[i].fret === sorted[i - 1].fret;
    for (let f = 1; f <= 4; f++) {
      if (prev !== undefined && (sameFret ? f < prev : f <= prev)) continue;
      assign(i + 1, [...acc, f]);
    }
  };
  assign(0, []);
  return out.sort((a, b) => a.cost - b.cost).slice(0, 16);
}

type BeatRef = { bar: number; beat: number; notes: TabNote[] };

export function computeFingerings(song: Song): Fingerings {
  const beats: BeatRef[] = [];
  let bar = 0;
  for (const s of song.sections)
    for (const b of s.bars) {
      b.beats.forEach((bt, i) => beats.push({ bar, beat: i, notes: bt.notes }));
      bar++;
    }
  const result: Fingerings = new Map();
  if (!beats.length) return result;

  // Left hand: Viterbi.
  const fretted = beats.map((b) => b.notes.filter((n) => n.fret > 0 && !LEFT_SKIP.has(n.technique)).map((n) => ({ string: n.string, fret: n.fret })));
  const layers = fretted.map(leftCandidates);
  const score: number[][] = [], back: number[][] = [];
  layers.forEach((cands, i) => {
    score[i] = []; back[i] = [];
    cands.forEach((c, ci) => {
      if (i === 0) { score[i][ci] = c.cost; back[i][ci] = 0; return; }
      let best = Infinity, arg = 0;
      layers[i - 1].forEach((p, pi) => {
        let t = score[i - 1][pi];
        if (p.pos >= 0 && c.pos >= 0) t += Math.abs(p.pos - c.pos) * 0.7;
        // Guide finger: the same string+fret keeps the same finger.
        for (const n of fretted[i]) {
          const before = fretted[i - 1].find((m) => m.string === n.string && m.fret === n.fret);
          if (before && p.fingers.get(n.string) !== c.fingers.get(n.string)) t += 1;
        }
        if (t < best) { best = t; arg = pi; }
      });
      score[i][ci] = best + c.cost;
      back[i][ci] = arg;
    });
  });
  const chosen: Cand[] = new Array(layers.length);
  let ci = score.at(-1)!.indexOf(Math.min(...score.at(-1)!));
  for (let i = layers.length - 1; i >= 0; i--) { chosen[i] = layers[i][ci]; ci = back[i][ci]; }

  // Right hand: rules.
  let lastSingle: { string: number; finger: RightFinger } | null = null;
  beats.forEach((b, i) => {
    const plucked = b.notes.filter((n) => !["hammer", "pull", "slide", "tap", "dead"].includes(n.technique)).sort((x, y) => y.string - x.string);
    const rh = new Map<number, RightFinger>();
    const bass = plucked.filter((n) => n.string >= 4);
    const treble = plucked.filter((n) => n.string <= 3);
    // Thumb: the lowest note when it is on a bass string, plus extra bass notes if fingers run out.
    if (bass.length) rh.set(bass[0].string, "p");
    const rest = [...bass.slice(1), ...treble]; // low → high
    const fingers: RightFinger[] = ["i", "m", "a"];
    if (rest.length > 3) rest.splice(0, rest.length - 3).forEach((n) => rh.set(n.string, "p"));
    if (rest.length === 1 && !bass.length) {
      // Single melody note: alternate i/m on the same or neighbouring string.
      const n = rest[0];
      const f: RightFinger = lastSingle && Math.abs(lastSingle.string - n.string) <= 1 && lastSingle.finger === "i" ? "m" : "i";
      rh.set(n.string, n.string === 1 && !lastSingle ? "a" : f);
      lastSingle = { string: n.string, finger: rh.get(n.string)! };
    } else {
      // Chords: map treble notes to i, m, a from low to high (skipping fingers when strings are skipped).
      const start = rest.length === 3 ? 0 : rest.length && rest.at(-1)!.string === 1 && rest.length <= 2 ? 3 - rest.length : 0;
      rest.forEach((n, k) => rh.set(n.string, fingers[Math.min(2, start + k)]));
      lastSingle = null;
    }
    for (const n of b.notes) {
      result.set(fingeringKey(b.bar, b.beat, n.string), {
        lh: n.fret > 0 && !LEFT_SKIP.has(n.technique) ? chosen[i].fingers.get(n.string) ?? 0 : 0,
        rh: rh.get(n.string) ?? null,
      });
    }
  });
  return result;
}
