import type { Song } from "@/lib/ir/schema";
import { eventBeats } from "@/lib/theory/validate";

/**
 * Practice path: how hard each bar is (0–1) and a short plan that starts with the hardest spots.
 * Difficulty combines what actually slows players down: stretches, hand shifts, picked-note speed,
 * dense chords and special techniques.
 */
export type BarDifficulty = { bar: number; score: number; reasons: string[] };
export type LessonStep = { title: string; startBar: number; endBar: number; speed: number; why: string };

export function barDifficulties(song: Song): BarDifficulty[] {
  const out: BarDifficulty[] = [];
  let bar = 0;
  let lastPos: number | null = null;
  for (const s of song.sections)
    for (const b of s.bars) {
      let span = 0, shift = 0, fastest = Infinity, dense = 0, tech = 0;
      for (const beat of b.beats) {
        const fretted = beat.notes.filter((n) => n.fret > 0 && n.technique !== "harmonic" && n.technique !== "dead").map((n) => n.fret);
        if (fretted.length) {
          span = Math.max(span, Math.max(...fretted) - Math.min(...fretted));
          const pos = Math.min(...fretted);
          if (lastPos !== null) shift += Math.abs(pos - lastPos);
          lastPos = pos;
        }
        if (beat.notes.length) fastest = Math.min(fastest, (eventBeats(beat) * 60) / song.tempo);
        if (beat.notes.length >= 4) dense++;
        tech += beat.notes.filter((n) => n.technique !== "none").length + (beat.percussion !== "none" ? 0.5 : 0);
      }
      const nps = fastest === Infinity ? 0 : 1 / fastest;
      const parts = {
        stretch: Math.min(1, Math.max(0, span - 2) / 3),
        shifts: Math.min(1, shift / 14),
        speed: Math.min(1, Math.max(0, nps - 4) / 8),
        chords: Math.min(1, dense / 4),
        techniques: Math.min(1, tech / 8),
      };
      const score = Math.min(1, parts.stretch * 0.25 + parts.shifts * 0.2 + parts.speed * 0.3 + parts.chords * 0.1 + parts.techniques * 0.15);
      const reasons = [
        parts.stretch >= 0.6 ? `stretch of ${span} frets` : "",
        parts.shifts >= 0.5 ? "big position shifts" : "",
        parts.speed >= 0.4 ? `${Math.round(nps)} notes/second` : "",
        parts.chords >= 0.5 ? "full chords" : "",
        parts.techniques >= 0.5 ? "lots of techniques" : "",
      ].filter(Boolean);
      out.push({ bar, score, reasons });
      bar++;
    }
  return out;
}

/** Hardest two-bar spots first (slow), then sections, then the whole piece up to tempo. */
export function lessonPlan(song: Song): LessonStep[] {
  const diff = barDifficulties(song);
  if (!diff.length) return [];
  const steps: LessonStep[] = [];
  const used = new Set<number>();
  const hardest = [...diff].sort((a, b) => b.score - a.score).filter((d) => d.score >= 0.25);
  for (const d of hardest) {
    if (steps.length >= 3) break;
    if (used.has(d.bar)) continue;
    const end = Math.min(diff.length - 1, d.bar + 1);
    for (let i = d.bar; i <= end; i++) used.add(i);
    steps.push({ title: `Hard spot: bars ${d.bar + 1}–${end + 1}`, startBar: d.bar, endBar: end, speed: d.score > 0.6 ? 0.5 : 0.6, why: d.reasons.join(", ") || "the densest bars" });
  }
  let bar = 0;
  for (const s of song.sections) {
    if (s.bars.length) steps.push({ title: `Section: ${s.name}`, startBar: bar, endBar: bar + s.bars.length - 1, speed: 0.75, why: s.note || "play it through without stopping" });
    bar += s.bars.length;
  }
  steps.push({ title: "Whole piece", startBar: 0, endBar: diff.length - 1, speed: 1, why: "full tempo, camera-ready take" });
  return steps;
}
