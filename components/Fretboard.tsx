"use client";

import { useMemo } from "react";
import type { Song, TabNote } from "@/lib/ir/schema";
import { computeFingerings, fingeringKey } from "@/lib/theory/fingering";

const FRETS = 13; // frets shown at once (window follows the hand)
const DOTS = [3, 5, 7, 9, 12, 15, 17];

/** A live fretboard: where the current notes are (with finger numbers) and, faintly, what comes next. */
export function Fretboard({ song, active }: { song: Song; active: { bar: number; beat: number } | null }) {
  const bars = useMemo(() => song.sections.flatMap((s) => s.bars), [song]);
  const fingerings = useMemo(() => computeFingerings(song), [song]);
  const at = (bar: number, beat: number) => bars[bar]?.beats[beat] ?? null;
  const cur = active ? at(active.bar, active.beat) : null;
  const nextRef = active ? (at(active.bar, active.beat + 1) ? { bar: active.bar, beat: active.beat + 1 } : { bar: active.bar + 1, beat: 0 }) : null;
  const next = nextRef ? at(nextRef.bar, nextRef.beat) : null;

  const fretsInView = [...(cur?.notes ?? []), ...(next?.notes ?? [])].filter((n) => n.fret > 0).map((n) => n.fret);
  const lo = fretsInView.length && Math.max(...fretsInView) > FRETS - 1 ? Math.max(1, Math.min(...fretsInView) - 1) : 1;
  const W = 760, H = 150, left = 40, top = 22, sx = (W - left - 10) / FRETS, sy = (H - top - 18) / 5;
  const x = (fret: number) => (fret === 0 ? left - 16 : left + (fret - lo + 0.5) * sx);
  const y = (string: number) => top + (string - 1) * sy;

  const dot = (n: TabNote, ghost: boolean, ref: { bar: number; beat: number } | null) => {
    if (n.technique === "dead" || (n.fret > 0 && (n.fret < lo || n.fret >= lo + FRETS))) return null;
    const f = ref ? fingerings.get(fingeringKey(ref.bar, ref.beat, n.string)) : undefined;
    const label = n.fret === 0 ? "" : n.technique === "harmonic" ? "◇" : f?.lh ? String(f.lh) : "";
    return (
      <g key={`${ghost}-${n.string}`} opacity={ghost ? 0.35 : 1}>
        <circle cx={x(n.fret)} cy={y(n.string)} r={n.fret === 0 ? 7 : 10} fill={ghost || n.fret === 0 ? "none" : "var(--accent)"} stroke="var(--accent)" strokeWidth={2} />
        {label && <text x={x(n.fret)} y={y(n.string) + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={ghost ? "var(--accent)" : "var(--accent-ink)"}>{label}</text>}
      </g>
    );
  };

  return (
    <div className="border-t border-line bg-surface px-3 py-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block w-full max-w-4xl" role="img" aria-label="Fretboard with the notes being played">
        {Array.from({ length: FRETS + 1 }, (_, i) => (
          <line key={i} x1={left + i * sx} x2={left + i * sx} y1={top} y2={top + 5 * sy} stroke="var(--line)" strokeWidth={i === 0 && lo === 1 ? 5 : 1.5} />
        ))}
        {Array.from({ length: FRETS }, (_, i) => lo + i).filter((f) => DOTS.includes(f)).map((f) => (
          <text key={f} x={left + (f - lo + 0.5) * sx} y={H - 2} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{f}</text>
        ))}
        {[1, 2, 3, 4, 5, 6].map((s) => (
          <line key={s} x1={left} x2={W - 10} y1={y(s)} y2={y(s)} stroke="var(--ink-3)" strokeWidth={0.6 + s * 0.25} />
        ))}
        {next?.notes.map((n) => dot(n, true, nextRef))}
        {cur?.notes.map((n) => dot(n, false, active))}
        {cur && cur.percussion !== "none" && (
          <text x={W - 14} y={14} textAnchor="end" fontSize="12" fontWeight="700" fill="var(--accent)">{cur.percussion === "slap" ? "SLAP" : "KNOCK"}</text>
        )}
      </svg>
    </div>
  );
}
