import type { Song } from "@/lib/ir/schema";
import type { Tune } from "@/lib/tune/tune";
import { barBeats, eventBeats, guitarOf, notePitch, tabMidi, validateSong } from "@/lib/theory/validate";

/** One attack in an arrangement: global time (quarter beats) and its sounding notes. */
type Attack = { t: number; dur: number; pitches: number[]; frets: number[]; strings: number[]; techniques: string[]; percussion: string };

export function attacks(song: Song): Attack[] {
  const perBar = barBeats(song.timeSignature);
  const g = guitarOf(song);
  const out: Attack[] = [];
  let barStart = 0;
  for (const sec of song.sections)
    for (const bar of sec.bars) {
      let pos = 0;
      if (bar.beats.length) {
        for (const b of bar.beats) {
          const pitched = b.notes.filter((n) => notePitch(n, g) !== null);
          if (b.notes.length || b.percussion !== "none")
            out.push({
              t: barStart + pos,
              dur: eventBeats(b),
              pitches: pitched.map((n) => notePitch(n, g)!),
              frets: pitched.map((n) => n.fret),
              strings: pitched.map((n) => n.string),
              techniques: b.notes.map((n) => n.technique).filter((x) => x !== "none"),
              percussion: b.percussion,
            });
          pos += eventBeats(b);
        }
      } else {
        for (const ch of bar.chords)
          for (const e of ch.rhythm) {
            const sounding = ch.voicing.frets.map((f, i) => ({ f, string: 6 - i })).filter((x) => x.f >= 0);
            if (e.play !== "rest" && sounding.length)
              out.push({
                t: barStart + pos,
                dur: eventBeats(e),
                pitches: sounding.map((x) => tabMidi(x.string, x.f, g)),
                frets: sounding.map((x) => x.f),
                strings: sounding.map((x) => x.string),
                techniques: [],
                percussion: "none",
              });
            pos += eventBeats(e);
          }
      }
      barStart += perBar;
    }
  return out;
}

export type MelodyScore = {
  /** Fraction of reference melody notes whose pitch is the top note of an attack at exactly that time. */
  exact: number;
  /** Same, but the attack may be up to half a beat early/late. */
  loose: number;
  transpose: number;
  barOffset: number;
};

/**
 * How much of a reference melody is audible as the top voice of the arrangement.
 * Searches the transposition (±2 octaves) and a start offset of 0–3 bars (intros) that fit best,
 * so a correct melody in another key still scores 100%.
 */
export function melodyScore(song: Song, tune: Tune): MelodyScore {
  const perBar = barBeats(tune.timeSignature);
  const ref = tune.bars.flatMap((b, i) => b.melody.map((n) => ({ t: i * perBar + n.start, midi: n.midi })));
  const atk = attacks(song).filter((a) => a.pitches.length).map((a) => ({ t: a.t, top: Math.max(...a.pitches) }));
  const byTime = new Map(atk.map((a) => [Math.round(a.t * 1000), a.top]));
  let best: MelodyScore = { exact: 0, loose: 0, transpose: 0, barOffset: 0 };
  if (!ref.length) return best;
  for (let offset = 0; offset <= 3; offset++)
    for (let k = -24; k <= 24; k++) {
      let exact = 0, loose = 0;
      for (const r of ref) {
        const t = r.t + offset * perBar;
        const want = r.midi + k;
        if (byTime.get(Math.round(t * 1000)) === want) exact++;
        if (atk.some((a) => Math.abs(a.t - t) <= 0.5 + 1e-9 && a.top === want)) loose++;
      }
      const s = { exact: exact / ref.length, loose: loose / ref.length, transpose: k, barOffset: offset };
      if (s.exact > best.exact || (s.exact === best.exact && s.loose > best.loose)) best = s;
    }
  return best;
}

export type Playability = {
  bars: number;
  maxSpan: number;
  meanSpan: number;
  highestFret: number;
  /** Mean jump of the hand position (lowest fretted note) between consecutive attacks, in frets. */
  meanShift: number;
  notesPerAttack: number;
  attacksPerBar: number;
  /** Share of attacks whose top note sits on strings 1–3 (melody register). */
  topOnTrebleStrings: number;
  warnings: number;
  errors: number;
};

export function playability(song: Song): Playability {
  const atk = attacks(song).filter((a) => a.pitches.length);
  const spans = atk.map((a) => {
    const f = a.frets.filter((x) => x > 0);
    return f.length ? Math.max(...f) - Math.min(...f) : 0;
  });
  const positions = atk.map((a) => {
    const f = a.frets.filter((x) => x > 0);
    return f.length ? Math.min(...f) : null;
  });
  let shift = 0, shifts = 0, last: number | null = null;
  for (const p of positions) {
    if (p === null) continue;
    if (last !== null) { shift += Math.abs(p - last); shifts++; }
    last = p;
  }
  const issues = validateSong(song);
  const bars = song.sections.reduce((n, s) => n + s.bars.length, 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    bars,
    maxSpan: Math.max(0, ...spans),
    meanSpan: avg(spans),
    highestFret: Math.max(0, ...atk.flatMap((a) => a.frets)),
    meanShift: shifts ? shift / shifts : 0,
    notesPerAttack: avg(atk.map((a) => a.pitches.length)),
    attacksPerBar: bars ? atk.length / bars : 0,
    topOnTrebleStrings: avg(atk.map((a) => {
      const top = Math.max(...a.pitches);
      return a.strings[a.pitches.indexOf(top)] <= 3 ? 1 : 0;
    })),
    warnings: issues.filter((i) => i.level === "warning").length,
    errors: issues.filter((i) => i.level === "error").length,
  };
}

export type Flair = {
  /** Expressive techniques (hammer, pull, slide, harmonics, taps, vibrato) per bar. */
  techniquesPerBar: number;
  /** Slaps and body knocks per bar. */
  percussionPerBar: number;
  /** Share of attacks that start off the beat (8th/16th syncopation). */
  syncopation: number;
  /** Number of different note lengths used (rhythmic variety). */
  rhythmicValues: number;
  /** Distinct bass notes per bar (moving bass line vs. static root). */
  bassMotion: number;
  /** Semitone range between lowest and highest note. */
  range: number;
  tuning: string;
  capo: number;
};

export function flair(song: Song): Flair {
  const atk = attacks(song);
  const bars = Math.max(1, song.sections.reduce((n, s) => n + s.bars.length, 0));
  const perBar = barBeats(song.timeSignature);
  const pitches = atk.flatMap((a) => a.pitches);
  const bassByBar = new Map<number, Set<number>>();
  for (const a of atk) {
    if (!a.pitches.length) continue;
    const bar = Math.floor(a.t / perBar + 1e-9);
    if (!bassByBar.has(bar)) bassByBar.set(bar, new Set());
    bassByBar.get(bar)!.add(Math.min(...a.pitches));
  }
  return {
    techniquesPerBar: atk.reduce((n, a) => n + a.techniques.filter((t) => t !== "dead").length, 0) / bars,
    percussionPerBar: atk.filter((a) => a.percussion !== "none" || a.techniques.includes("dead")).length / bars,
    syncopation: atk.length ? atk.filter((a) => Math.abs(a.t - Math.round(a.t)) > 1e-6).length / atk.length : 0,
    rhythmicValues: new Set(atk.map((a) => a.dur.toFixed(3))).size,
    bassMotion: [...bassByBar.values()].reduce((n, s) => n + s.size, 0) / bars,
    range: pitches.length ? Math.max(...pitches) - Math.min(...pitches) : 0,
    tuning: song.tuning,
    capo: song.capo,
  };
}
