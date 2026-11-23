import { Chord, Note } from "tonal";
import type { Song } from "@/lib/ir/schema";
import type { Tune } from "@/lib/tune/tune";
import { barBeats, chordTones, errorsOnly, eventBeats, guitarOf, validateAgainstTune, validateSong, voicingMidi } from "@/lib/theory/validate";
import { attacks, melodyScore, playability, flair as flairOf } from "./metrics";
import type { Direction } from "@/lib/arrange/plan";

/**
 * Deterministic musical review of an arrangement. Each criterion says how much it can be trusted:
 *  - verified:   checked against ground truth (an imported melody, the theory checker)
 *  - heuristic:  measured from the tab with rules of thumb (no human hand or ear involved)
 *  - unverified: cannot be checked with what we have
 */
export type Status = "verified" | "heuristic" | "unverified";
export type Criterion = { key: string; label: string; score: number | null; status: Status; detail: string };
export type Review = { overall: number; criteria: Criterion[]; errors: number };

type Prefs = Partial<Pick<Direction, "flair" | "difficulty" | "reharm" | "fidelity">>;

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const WEIGHTS: Record<string, number> = {
  melody: 0.3, clarity: 0.12, harmony: 0.15, voiceLeading: 0.08, rhythm: 0.1, playability: 0.15, restraint: 0.1, reharm: 0.05,
};

/** Which chord is sounding at each global time (quarter beats). */
function chordAt(song: Song): (t: number) => string | null {
  const perBar = barBeats(song.timeSignature);
  const spans: { from: number; to: number; symbol: string }[] = [];
  let bar = 0;
  for (const s of song.sections)
    for (const b of s.bars) {
      let pos = bar * perBar;
      for (const c of b.chords) {
        const len = c.rhythm.reduce((n, e) => n + eventBeats(e), 0);
        spans.push({ from: pos, to: pos + len, symbol: c.symbol });
        pos += len;
      }
      bar++;
    }
  return (t) => spans.find((s) => t >= s.from - 1e-9 && t < s.to - 1e-9)?.symbol ?? null;
}

/** Diatonic pitch classes of the song's key (minor includes raised 6th/7th). */
export function keyScale(key: string): Set<number> | null {
  const m = key.trim().match(/^([A-Ga-g][#b]?)\s*(minor|min|m(?!aj))?/);
  const tonic = m ? Note.chroma(m[1][0].toUpperCase() + m[1].slice(1)) : undefined;
  if (!m || tonic === undefined || tonic === null || Number.isNaN(tonic)) return null;
  const steps = m[2] ? [0, 2, 3, 5, 7, 8, 9, 10, 11] : [0, 2, 4, 5, 7, 9, 11];
  return new Set(steps.map((s) => (tonic + s) % 12));
}

/** Share of chords whose tones fall outside the key — a measure of how reharmonized the song is. */
export function outsideKeyShare(song: Song): { share: number; outside: number; total: number } | null {
  const scale = keyScale(song.key);
  if (!scale) return null;
  const chords = song.sections.flatMap((s) => s.bars.flatMap((b) => b.chords));
  let outside = 0;
  for (const c of chords) {
    const sym = c.symbol.replace(/7?alt/, "7b9#9");
    const notes = Chord.get(sym).notes;
    if (notes.some((n) => !scale.has(Note.chroma(n) ?? -1))) outside++;
  }
  return { share: chords.length ? outside / chords.length : 0, outside, total: chords.length };
}

const REHARM_BAND: Record<NonNullable<Prefs["reharm"]>, [number, number]> = {
  none: [0, 0.15], light: [0.05, 0.35], moderate: [0.2, 0.6], bold: [0.35, 1],
};
const FLAIR_BAND: Record<NonNullable<Prefs["flair"]>, [number, number]> = {
  clean: [0, 0.6], expressive: [0.3, 1.8], showstopper: [0.8, 3.5],
};
const LIMITS = {
  beginner: { span: 3, fret: 7, shift: 1.5, attacks: 7 },
  intermediate: { span: 4, fret: 12, shift: 2.5, attacks: 11 },
  advanced: { span: 5, fret: 17, shift: 4, attacks: 18 },
};

const inBand = (x: number, [lo, hi]: [number, number], soft: number) =>
  x < lo ? clamp(1 - (lo - x) / soft) : x > hi ? clamp(1 - (x - hi) / soft) : 1;

export function reviewSong(song: Song, opts: { tune?: Tune | null; prefs?: Prefs } = {}): Review {
  const { tune, prefs = {} } = opts;
  const g = guitarOf(song);
  const fidelity = prefs.fidelity ?? "exact";
  const difficulty = prefs.difficulty ?? song.difficulty;
  const atk = attacks(song).filter((a) => a.pitches.length);
  const criteria: Criterion[] = [];
  const fingerstyle = song.texture === "fingerstyle";

  // 1. Melody — only checkable against an imported tune.
  if (tune) {
    const m = melodyScore(song, tune);
    const strictIssues = errorsOnly(validateAgainstTune(song, tune, undefined, "exact")).length;
    const score = fidelity === "exact" ? m.exact : fidelity === "embellished" ? (m.exact + m.loose) / 2 : m.loose;
    criteria.push({
      key: "melody", label: "Melody kept", score, status: "verified",
      detail: `${pct(m.exact)} of melody notes on the exact beat and pitch, ${pct(m.loose)} within half a beat${m.transpose ? `, transposed ${m.transpose > 0 ? "+" : ""}${m.transpose}` : ""}${strictIssues && fidelity !== "exact" ? ` (${fidelity} mode allows deviations)` : ""}.`,
    });
  } else {
    criteria.push({
      key: "melody", label: "Melody kept", score: null, status: "unverified",
      detail: "Written from the model's memory of the song, not checked against a score. Import a MIDI, Guitar Pro or MusicXML file to verify it note by note.",
    });
  }

  // 2. Melodic clarity: the top voice should stand apart from the accompaniment.
  if (fingerstyle && atk.length) {
    const multi = atk.filter((a) => a.pitches.length > 1);
    const gaps = multi.map((a) => {
      const s = [...a.pitches].sort((x, y) => y - x);
      return s[0] - s[1];
    });
    const separated = gaps.length ? gaps.filter((x) => x >= 3).length / gaps.length : 1;
    const treble = avg(atk.map((a) => (a.strings[a.pitches.indexOf(Math.max(...a.pitches))] <= 3 ? 1 : 0)));
    criteria.push({
      key: "clarity", label: "Melody stands out", score: clamp(0.6 * separated + 0.4 * treble), status: "heuristic",
      detail: `Top voice is ≥ a minor 3rd above the next voice in ${pct(separated)} of chords; on the treble strings ${pct(treble)} of the time.`,
    });
  }

  // 3. Harmonic fit: supporting notes on strong beats should belong to the labelled chord.
  const at = chordAt(song);
  const strong = fingerstyle
    ? atk.filter((a) => Math.abs(a.t - Math.round(a.t)) < 1e-6).flatMap((a) => {
        const sym = at(a.t);
        const tones = sym ? chordTones(sym) : null;
        if (!tones) return [];
        const top = Math.max(...a.pitches);
        return a.pitches.filter((p) => p !== top).map((p) => tones.allowed.has(p % 12) || p % 12 === tones.bass);
      })
    : song.sections.flatMap((s) => s.bars.flatMap((b) => b.chords.flatMap((c) => {
        const tones = chordTones(c.symbol);
        return tones ? voicingMidi(c.voicing.frets, g).map((p) => tones.allowed.has(p % 12)) : [];
      })));
  if (strong.length) {
    const fit = strong.filter(Boolean).length / strong.length;
    criteria.push({
      key: "harmony", label: "Harmony fits", score: clamp((fit - 0.6) / 0.4), status: "heuristic",
      detail: `${pct(fit)} of bass and inner-voice notes on the beat are tones of the labelled chord.`,
    });
  }

  // 4. Voice leading between consecutive chord grips.
  const grips = song.sections.flatMap((s) => s.bars.flatMap((b) => b.chords.map((c) => voicingMidi(c.voicing.frets, g))));
  const moves: number[] = [];
  for (let i = 1; i < grips.length; i++) {
    if (!grips[i].length || !grips[i - 1].length) continue;
    moves.push(avg(grips[i].map((p) => Math.min(...grips[i - 1].map((q) => Math.abs(p - q))))));
  }
  if (moves.length) {
    const m = avg(moves);
    criteria.push({
      key: "voiceLeading", label: "Voice leading", score: clamp(1 - (m - 1.5) / 4), status: "heuristic",
      detail: `Each voice moves ${m.toFixed(1)} semitones on average between chords (≤ 2 is smooth).`,
    });
  }

  // 5. Rhythmic coherence: a recognisable groove that repeats with variation.
  const perBar = barBeats(song.timeSignature);
  const all = attacks(song);
  const patterns = new Map<number, string>();
  for (const a of all) {
    const bar = Math.floor(a.t / perBar + 1e-9);
    const lowest = a.pitches.length ? Math.min(...a.pitches) : null;
    const bass = a.percussion !== "none" || (lowest !== null && lowest < 55 && a.strings[a.pitches.indexOf(lowest)] >= 4);
    if (!bass) continue;
    patterns.set(bar, `${patterns.get(bar) ?? ""}${(a.t - bar * perBar).toFixed(2)}${a.percussion[0]},`);
  }
  const bars = song.sections.reduce((n, s) => n + s.bars.length, 0);
  if (fingerstyle && bars > 1) {
    const counts = new Map<string, number>();
    for (const p of patterns.values()) counts.set(p, (counts.get(p) ?? 0) + 1);
    const repeated = [...patterns.values()].filter((p) => counts.get(p)! > 1).length / bars;
    // Sweet spot: groove repeats in 40–90% of bars (100% can be monotonous, <30% feels aimless).
    criteria.push({
      key: "rhythm", label: "Groove", score: inBand(repeated, [0.4, 0.9], 0.4), status: "heuristic",
      detail: `The bass/percussion pattern recurs in ${pct(repeated)} of bars (${counts.size} distinct patterns).`,
    });
  }

  // 6. Playability against the target level.
  const p = playability(song);
  const lim = LIMITS[difficulty];
  const over = [
    p.maxSpan > lim.span ? `stretch of ${p.maxSpan} frets` : "",
    p.highestFret > lim.fret ? `up to fret ${p.highestFret}` : "",
    p.meanShift > lim.shift ? `hand moves ${p.meanShift.toFixed(1)} frets per note` : "",
    p.attacksPerBar > lim.attacks ? `${p.attacksPerBar.toFixed(1)} attacks per bar` : "",
  ].filter(Boolean);
  criteria.push({
    key: "playability", label: `Playable (${difficulty})`, score: clamp(1 - over.length * 0.25 - p.errors * 0.05), status: "heuristic",
    detail: over.length
      ? `Harder than ${difficulty}: ${over.join(", ")}.`
      : `Max stretch ${p.maxSpan} frets, highest fret ${p.highestFret}, ${p.attacksPerBar.toFixed(1)} attacks per bar. Fingerings are estimated from fret spans, not tested by hand.`,
  });

  // 7. Restraint: techniques should match the intended flair, not be sprinkled for show.
  if (fingerstyle) {
    const f = flairOf(song);
    const level = prefs.flair ?? "expressive";
    const score = inBand(f.techniquesPerBar, FLAIR_BAND[level], 1) * (level === "clean" && f.percussionPerBar > 0.25 ? 0.6 : 1);
    criteria.push({
      key: "restraint", label: "Techniques in proportion", score, status: "heuristic",
      detail: `${f.techniquesPerBar.toFixed(1)} techniques and ${f.percussionPerBar.toFixed(1)} percussive hits per bar for a ${level} arrangement.`,
    });
  }

  // 8. Reharmonization amount vs. what was asked.
  const out = outsideKeyShare(song);
  if (out) {
    const want = prefs.reharm;
    criteria.push({
      key: "reharm", label: "Reharmonization", score: want ? inBand(out.share, REHARM_BAND[want], 0.25) : null, status: "heuristic",
      detail: `${out.outside} of ${out.total} chords use notes outside ${song.key}${want ? ` (asked for: ${want})` : ""}.`,
    });
  }

  const errors = errorsOnly(validateSong(song)).length + (tune && fidelity !== "free" ? errorsOnly(validateAgainstTune(song, tune, undefined, fidelity)).length : 0);
  const scored = criteria.filter((c) => c.score !== null);
  const weight = scored.reduce((n, c) => n + (WEIGHTS[c.key] ?? 0.1), 0);
  const overall = weight ? scored.reduce((n, c) => n + c.score! * (WEIGHTS[c.key] ?? 0.1), 0) / weight : 0;
  return { overall: clamp(overall - Math.min(0.3, errors * 0.03)), criteria, errors };
}
