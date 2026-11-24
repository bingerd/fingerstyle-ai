"use client";

import { useMemo, useState } from "react";
import type { Song } from "@/lib/ir/schema";
import { detectMoments, type Moment } from "@/lib/eval/moments";

const ICON: Record<Moment["kind"], string> = {
  harmonics: "✧", "slap-groove": "◉", tapping: "☝", "fast-run": "»", "triplet-fill": "³", legato: "⌒", campanella: "♫", finale: "★",
};

/** The signature moments of the arrangement: click to loop them slowly and read how to play them. */
export function Moments({ song, onPractice }: { song: Song; onPractice: (m: Moment) => void }) {
  const moments = useMemo(() => detectMoments(song), [song]);
  const [active, setActive] = useState<string | null>(null);
  if (!moments.length) return null;
  const current = moments.find((m) => m.kind === active);
  return (
    <section aria-labelledby="moments" className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="moments" className="font-display text-xl font-semibold">Signature moments</h2>
        <p className="text-xs text-ink-3">Click one to loop it slowly</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {moments.map((m) => (
          <button
            key={m.kind}
            onClick={() => { setActive(m.kind); onPractice(m); }}
            aria-pressed={active === m.kind}
            className={`focus-ring flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${active === m.kind ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2 hover:border-ink-3 hover:text-ink"}`}
          >
            <span aria-hidden className="text-accent">{ICON[m.kind]}</span>
            {m.title}
            <span className="font-mono text-xs text-ink-3">{m.startBar === m.endBar ? `bar ${m.startBar + 1}` : `bars ${m.startBar + 1}–${m.endBar + 1}`}</span>
          </button>
        ))}
      </div>
      {current && (
        <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm leading-relaxed text-ink-2">
          <b className="text-ink">{current.title}:</b> {current.how} <span className="text-ink-3">(looping at {Math.round(current.speed * 100)}%)</span>
        </p>
      )}
    </section>
  );
}
