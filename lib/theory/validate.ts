import { Chord, Note } from "tonal";
import type { ChordEvent, RhythmEvent, Song, TabBeat, TabNote } from "@/lib/ir/schema";
import { midiName, type Tune } from "@/lib/tune/tune";

/** Standard tuning as MIDI numbers, low E first. */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];
const MAX_FRET = 20;

/** Open-string MIDI notes per tuning, low string first. */
export const TUNINGS: Record<Song["tuning"], number[]> = {
  standard: [40, 45, 50, 55, 59, 64],
  "drop-d": [38, 45, 50, 55, 59, 64],
  dadgad: [38, 45, 50, 55, 57, 62],
  "open-d": [38, 45, 50, 54, 57, 62],
  "open-g": [38, 43, 50, 55, 59, 62],
  "half-step-down": [39, 44, 49, 54, 58, 63],
};

/** The instrument a song is written for. Frets are relative to the capo, as in real tabs. */
export type Guitar = { tuning: number[]; capo: number };
export const STANDARD: Guitar = { tuning: STANDARD_TUNING, capo: 0 };
export const guitarOf = (song: Pick<Song, "tuning" | "capo">): Guitar => ({
  tuning: TUNINGS[song.tuning] ?? STANDARD_TUNING,
  capo: song.capo ?? 0,
});

/** Semitones above the open string at which a natural harmonic sounds. */
const NATURAL_HARMONIC: Record<number, number> = { 12: 12, 7: 19, 19: 19, 5: 24, 24: 24, 4: 28, 9: 28, 16: 28, 3: 31 };

export type Issue = { level: "error" | "warning"; where: string; message: string };

export function eventBeats(e: { value: number; dotted: boolean; triplet?: boolean }): number {
  return (4 / e.value) * (e.dotted ? 1.5 : 1) * (e.triplet ? 2 / 3 : 1);
}

export function rhythmBeats(rhythm: RhythmEvent[]): number {
  return rhythm.reduce((sum, e) => sum + eventBeats(e), 0);
}

/** Quarter-note beats per bar for a time signature. */
export function barBeats(ts: Song["timeSignature"]): number {
  return ts.numerator * (4 / ts.denominator);
}

/** Sounding MIDI notes of a voicing (low to high), skipping muted strings. */
export function voicingMidi(frets: number[], g: Guitar = STANDARD): number[] {
  return frets.flatMap((f, i) => (f < 0 ? [] : [g.tuning[i] + g.capo + f]));
}

const chroma = (n: string) => Note.chroma(n) ?? -1;

/** Allowed pitch classes and required guide tones for a chord symbol. */
export function chordTones(symbol: string): { allowed: Set<number>; required: number[]; bass?: number } | null {
  const isAlt = /alt$/.test(symbol.replace(/\/.*$/, ""));
  const c = Chord.get(isAlt ? symbol.replace(/7?alt/, "7") : symbol);
  if (c.empty || !c.tonic) return null;
  const root = chroma(c.tonic);
  const allowed = new Set(c.notes.map(chroma));
  const intervals = c.intervals;
  if (isAlt) for (const iv of [1, 3, 6, 8]) allowed.add((root + iv) % 12); // b9 #9 #11 b13
  const required: number[] = [];
  const third = intervals.find((i) => i === "3M" || i === "3m");
  const sus = intervals.find((i) => i === "4P" || i === "2M");
  if (third) required.push((root + (third === "3M" ? 4 : 3)) % 12);
  else if (sus && !intervals.includes("3M")) required.push((root + (sus === "4P" ? 5 : 2)) % 12);
  const seventh = intervals.find((i) => i === "7m" || i === "7M" || i === "7d");
  if (seventh) required.push((root + (seventh === "7M" ? 11 : seventh === "7m" ? 10 : 9)) % 12);
  const bass = c.bass ? chroma(c.bass) : undefined;
  return { allowed, required, bass };
}

const pcName = (pc: number) => ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"][pc];

/** Validate a single chord event's voicing against its symbol and playability rules. */
export function validateChord(ev: ChordEvent, where: string, g: Guitar = STANDARD): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string) => issues.push({ level: "error", where, message });
  const warn = (message: string) => issues.push({ level: "warning", where, message });
  const { frets, fingers } = ev.voicing;

  if (frets.length !== 6) return [{ level: "error", where, message: `voicing.frets must have 6 entries (has ${frets.length})` }];
  if (fingers.length !== 6) err(`voicing.fingers must have 6 entries (has ${fingers.length})`);
  if (frets.some((f) => f < -1 || f > MAX_FRET || !Number.isInteger(f))) err(`frets out of range: [${frets.join(",")}]`);

  const sounding = frets.filter((f) => f >= 0).length;
  const isPower = /5$/.test(ev.symbol.replace(/\/.*$/, ""));
  if (sounding < (isPower ? 2 : 3)) err(`only ${sounding} sounding strings`);

  const fretted = frets.filter((f) => f > 0);
  if (fretted.length) {
    const span = Math.max(...fretted) - Math.min(...fretted);
    if (span > 5) err(`fret span of ${span} is unplayable (frets ${frets.join(",")})`);
    else if (span === 5) warn(`wide stretch: fret span of 5`);
  }

  const tones = chordTones(ev.symbol);
  if (!tones) {
    err(`unrecognized chord symbol "${ev.symbol}"`);
    return issues;
  }
  const midi = voicingMidi(frets, g);
  const pcs = new Set(midi.map((m) => m % 12));
  const missing = tones.required.filter((pc) => !pcs.has(pc));
  if (missing.length) err(`${ev.symbol} voicing is missing guide tone(s) ${missing.map(pcName).join(", ")}`);
  const foreign = [...pcs].filter((pc) => !tones.allowed.has(pc));
  if (foreign.length) warn(`${ev.symbol} voicing contains non-chord tone(s) ${foreign.map(pcName).join(", ")}`);
  if (tones.bass !== undefined && midi.length && midi[0] % 12 !== tones.bass)
    err(`${ev.symbol} needs ${pcName(tones.bass)} in the bass, lowest note is ${pcName(midi[0] % 12)}`);
  return issues;
}

/** Pitch (MIDI) of a fretted tab note; tab strings are numbered 1 = high e … 6 = low E. */
export const tabMidi = (string: number, fret: number, g: Guitar = STANDARD) => g.tuning[6 - string] + g.capo + fret;

/** Sounding pitch of a tab note including harmonics; null for dead (percussive) notes. */
export function notePitch(n: Pick<TabNote, "string" | "fret"> & { technique?: TabNote["technique"] }, g: Guitar = STANDARD): number | null {
  if (n.technique === "dead") return null;
  if (n.technique === "harmonic") return tabMidi(n.string, 0, g) + (NATURAL_HARMONIC[n.fret] ?? n.fret + 12);
  if (n.technique === "artificial-harmonic") return tabMidi(n.string, n.fret, g) + 12;
  return tabMidi(n.string, n.fret, g);
}

/** Validate explicit tab beats: timing, one note per string, reachable frets, techniques, chord labels. */
export function validateBeats(beats: TabBeat[], perBar: number, symbols: string[], where: string): Issue[] {
  const issues: Issue[] = [];
  const total = beats.reduce((n, b) => n + eventBeats(b), 0);
  if (Math.abs(total - perBar) > 1e-6) issues.push({ level: "error", where, message: `tab beats add up to ${+total.toFixed(3)} beats, bar needs ${perBar}` });
  const tripletRun = beats.reduce((run, b) => (b.triplet ? run + 1 : run % 3 === 0 ? 0 : run), 0);
  if (tripletRun % 3 !== 0) issues.push({ level: "warning", where, message: "triplets should come in groups of 3" });
  const lastFret = new Map<number, number>();
  let pos = 0;
  for (const b of beats) {
    const at = `${where} beat ${+(pos + 1).toFixed(2)}`;
    pos += eventBeats(b);
    const notes = b.notes ?? [];
    const strings = notes.map((n) => n.string);
    if (strings.some((s) => s < 1 || s > 6 || !Number.isInteger(s))) issues.push({ level: "error", where: at, message: `string numbers must be 1–6 (got ${strings.join(",")})` });
    if (new Set(strings).size !== strings.length) issues.push({ level: "error", where: at, message: `two notes on the same string (${strings.join(",")})` });
    if (notes.some((n) => n.fret < 0 || n.fret > MAX_FRET)) issues.push({ level: "error", where: at, message: "fret out of range" });
    const fretted = notes.filter((n) => n.fret > 0 && n.technique !== "dead" && n.technique !== "harmonic" && n.technique !== "tap").map((n) => n.fret);
    if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 5)
      issues.push({ level: "error", where: at, message: `fret span ${Math.max(...fretted) - Math.min(...fretted)} is unplayable` });
    if (notes.filter((n) => n.technique !== "dead").length > 5) issues.push({ level: "warning", where: at, message: "more than 5 plucked notes at once" });
    if (b.percussion === "slap" && notes.some((n) => n.string >= 5 && n.technique !== "dead"))
      issues.push({ level: "warning", where: at, message: "thumb slap and a plucked bass note on strings 5–6 at the same time" });
    for (const n of notes) {
      const prev = lastFret.get(n.string);
      if (n.technique === "hammer" || n.technique === "pull" || n.technique === "slide") {
        if (prev === undefined) issues.push({ level: "warning", where: at, message: `${n.technique} on string ${n.string} has no previous note on that string in this bar` });
        else if (n.technique === "hammer" && n.fret <= prev) issues.push({ level: "error", where: at, message: `hammer-on must go up the neck (fret ${prev} → ${n.fret})` });
        else if (n.technique === "pull" && n.fret >= prev) issues.push({ level: "error", where: at, message: `pull-off must go down the neck (fret ${prev} → ${n.fret})` });
        else if (n.technique === "slide" && n.fret === prev) issues.push({ level: "error", where: at, message: "slide to the same fret" });
      }
      if (n.technique === "harmonic" && !(n.fret in NATURAL_HARMONIC)) issues.push({ level: "error", where: at, message: `no natural harmonic at fret ${n.fret} (use 12, 7, 5, 4, 19…)` });
      if (n.technique !== "dead") lastFret.set(n.string, n.fret);
    }
    if (b.chord && !symbols.includes(b.chord)) issues.push({ level: "warning", where: at, message: `label "${b.chord}" is not one of the bar's chords` });
  }
  return issues;
}

/**
 * The accuracy guarantee for imported tunes: every melody onset must be attacked in the tab
 * at the same time, with the melody (plus song.transpose) as the highest note.
 */
export function validateAgainstTune(song: Song, tune: Tune, onlyBar?: number, fidelity: "exact" | "embellished" | "free" = "exact"): Issue[] {
  if (fidelity === "free") return [];
  if (fidelity === "embellished") return validateEmbellished(song, tune, onlyBar);
  const issues: Issue[] = [];
  const g = guitarOf(song);
  const bars = song.sections.flatMap((s) => s.bars.map((b, i) => ({ bar: b, where: `${s.name} bar ${i + 1}` })));
  if (onlyBar === undefined && bars.length !== tune.bars.length)
    issues.push({ level: "error", where: "song", message: `arrangement has ${bars.length} bars, the tune has ${tune.bars.length}` });
  tune.bars.forEach((tb, i) => {
    const target = bars[i];
    if (!target || (onlyBar !== undefined && i !== onlyBar)) return;
    const starts = new Map<number, number[]>();
    let pos = 0;
    for (const b of target.bar.beats) {
      starts.set(Math.round(pos * 1000) / 1000, b.notes.map((n) => notePitch(n, g)).filter((p): p is number => p !== null));
      pos += eventBeats(b);
    }
    for (const note of tb.melody) {
      const want = note.midi + song.transpose;
      const at = `${target.where} (tune bar ${i + 1}) at beat ${note.start + 1}`;
      const pitches = starts.get(Math.round(note.start * 1000) / 1000);
      if (!pitches) {
        issues.push({ level: "error", where: at, message: `melody note ${midiName(want)} starts here but the tab has no attack at this time` });
      } else if (!pitches.length || Math.max(...pitches) !== want) {
        const top = pitches.length ? midiName(Math.max(...pitches)) : "a rest";
        issues.push({ level: "error", where: at, message: `top note should be melody ${midiName(want)}, tab has ${top}` });
      }
    }
  });
  return issues;
}

/** Global attack times (quarter beats) of a song's tab with their top sounding pitch. */
function tabTops(song: Song): { t: number; top: number | null; bar: number; where: string }[] {
  const g = guitarOf(song);
  const perBar = barBeats(song.timeSignature);
  const out: { t: number; top: number | null; bar: number; where: string }[] = [];
  let bar = 0;
  for (const s of song.sections)
    s.bars.forEach((b, i) => {
      let pos = 0;
      for (const beat of b.beats) {
        const ps = beat.notes.map((n) => notePitch(n, g)).filter((p): p is number => p !== null);
        out.push({ t: bar * perBar + pos, top: ps.length ? Math.max(...ps) : null, bar, where: `${s.name} bar ${i + 1}` });
        pos += eventBeats(beat);
      }
      bar++;
    });
  return out;
}

/**
 * Looser melody check for "embellished" arrangements: each melody note must still be heard as the
 * top voice, but may be anticipated or delayed by up to half a beat (grace notes, push/pull phrasing).
 */
function validateEmbellished(song: Song, tune: Tune, onlyBar?: number): Issue[] {
  const issues: Issue[] = [];
  const perBar = barBeats(tune.timeSignature);
  const bars = song.sections.reduce((n, s) => n + s.bars.length, 0);
  if (onlyBar === undefined && bars !== tune.bars.length)
    issues.push({ level: "error", where: "song", message: `arrangement has ${bars} bars, the tune has ${tune.bars.length}` });
  const tops = tabTops(song);
  tune.bars.forEach((tb, i) => {
    if (onlyBar !== undefined && i !== onlyBar) return;
    for (const note of tb.melody) {
      const t = i * perBar + note.start;
      const want = note.midi + song.transpose;
      if (!tops.some((a) => Math.abs(a.t - t) <= 0.5 + 1e-9 && a.top === want))
        issues.push({ level: "error", where: `tune bar ${i + 1} at beat ${note.start + 1}`, message: `melody note ${midiName(want)} is not the top note of any attack within half a beat` });
    }
  });
  return issues;
}

/** Everything that can be checked within one bar (chord grips, rhythm sums, tab beats). */
export function validateBar(song: Song, bar: Song["sections"][number]["bars"][number], where: string, g: Guitar = guitarOf(song), perBar = barBeats(song.timeSignature)): Issue[] {
  const issues: Issue[] = [];
  if (!bar.chords.length) issues.push({ level: "error", where, message: "bar has no chords" });
  let total = 0;
  for (const ch of bar.chords) {
    if (!ch.rhythm.length) issues.push({ level: "error", where, message: `${ch.symbol} has an empty rhythm` });
    total += rhythmBeats(ch.rhythm);
    issues.push(...validateChord(ch, `${where} (${ch.symbol})`, g));
  }
  if (Math.abs(total - perBar) > 1e-6)
    issues.push({ level: "error", where, message: `chord rhythms add up to ${total} beats, bar needs ${perBar}` });
  if (bar.beats.length) issues.push(...validateBeats(bar.beats, perBar, bar.chords.map((c) => c.symbol), where));
  else if (song.texture === "fingerstyle") issues.push({ level: "error", where, message: "fingerstyle bar has no tab beats" });
  return issues;
}

export function validateSong(song: Song): Issue[] {
  const issues: Issue[] = [];
  const perBar = barBeats(song.timeSignature);
  const ids = new Set<string>();
  const g = guitarOf(song);
  if (song.capo < 0 || song.capo > 9) issues.push({ level: "error", where: "capo", message: "capo must be 0–9" });
  if (![2, 4, 8].includes(song.timeSignature.denominator))
    issues.push({ level: "error", where: "timeSignature", message: "denominator must be 2, 4 or 8" });

  song.sections.forEach((section, si) => {
    section.bars.forEach((bar, bi) => {
      const where = `${section.name} bar ${bi + 1}`;
      for (const ch of bar.chords) {
        if (ids.has(ch.id)) issues.push({ level: "error", where, message: `duplicate chord id "${ch.id}"` });
        ids.add(ch.id);
      }
      issues.push(...validateBar(song, bar, where, g, perBar));
    });
    if (!section.bars.length) issues.push({ level: "error", where: `section ${si + 1}`, message: "section has no bars" });
  });
  return issues;
}

export const errorsOnly = (issues: Issue[]) => issues.filter((i) => i.level === "error");

export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `- [${i.level}] ${i.where}: ${i.message}`).join("\n");
}
