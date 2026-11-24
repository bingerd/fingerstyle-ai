"use client";

import { useMemo, useState } from "react";
import type { Song } from "@/lib/ir/schema";
import { barDifficulties, lessonPlan, type LessonStep } from "@/lib/eval/lesson";

const stepKey = (s: LessonStep) => `${s.startBar}-${s.endBar}-${s.speed}`;
const heat = (x: number) => `color-mix(in oklab, var(--accent) ${Math.round(15 + x * 85)}%, var(--surface-2))`;

/** Difficulty heatmap + hardest-first practice steps with a tempo ladder; progress is saved with the song. */
export function PracticePlan(props: {
  song: Song;
  savedId: string | null;
  mastered: string[];
  onPractice: (range: { startBar: number; endBar: number }, speed: number) => void;
  onProgress: (mastered: string[]) => void;
}) {
  const diff = useMemo(() => barDifficulties(props.song), [props.song]);
  const steps = useMemo(() => lessonPlan(props.song), [props.song]);
  const [active, setActive] = useState<string | null>(null);
  if (!diff.length || props.song.texture !== "fingerstyle") return null;
  const done = new Set(props.mastered);
  const progress = steps.filter((s) => done.has(stepKey(s))).length;

  function toggle(s: LessonStep) {
    const k = stepKey(s);
    const next = done.has(k) ? props.mastered.filter((m) => m !== k) : [...props.mastered, k];
    props.onProgress(next);
  }

  return (
    <section aria-labelledby="practice" className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="practice" className="font-display text-xl font-semibold">Practice path</h2>
        <span className="text-xs text-ink-3">{progress}/{steps.length} mastered{props.savedId ? "" : " (save to keep progress)"}</span>
      </div>
      <div className="mt-3" aria-label="Difficulty per bar">
        <div className="flex gap-0.5">
          {diff.map((d) => (
            <button
              key={d.bar}
              onClick={() => props.onPractice({ startBar: d.bar, endBar: Math.min(diff.length - 1, d.bar + 1) }, 0.6)}
              title={`Bar ${d.bar + 1}: ${d.reasons.join(", ") || "comfortable"}`}
              className="focus-ring h-6 min-w-0 flex-1 rounded-sm transition hover:scale-y-125"
              style={{ background: heat(d.score) }}
              aria-label={`Bar ${d.bar + 1}, difficulty ${Math.round(d.score * 100)}%`}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-ink-3"><span>bar 1</span><span>darker = harder · click to loop</span><span>bar {diff.length}</span></div>
      </div>
      <ol className="mt-3 space-y-1.5">
        {steps.map((s) => {
          const k = stepKey(s);
          return (
            <li key={k} className={`flex flex-wrap items-center gap-2 rounded-xl px-2 py-1.5 ${active === k ? "bg-surface-2" : ""}`}>
              <input type="checkbox" checked={done.has(k)} onChange={() => toggle(s)} aria-label={`Mastered: ${s.title}`} className="accent-[var(--accent)]" />
              <button onClick={() => { setActive(k); props.onPractice(s, s.speed); }} className="focus-ring min-w-0 flex-1 text-left">
                <span className={`text-sm font-medium ${done.has(k) ? "text-ink-3 line-through" : ""}`}>{s.title}</span>
                <span className="block truncate text-xs text-ink-3">{s.why}</span>
              </button>
              <span className="flex gap-0.5" aria-label="Tempo ladder">
                {[0.6, 0.7, 0.8, 0.9, 1].map((v) => (
                  <button key={v} onClick={() => { setActive(k); props.onPractice(s, v); }} className={`focus-ring rounded-md px-1.5 py-0.5 font-mono text-[11px] ${v === s.speed ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-2 hover:text-ink"}`}>
                    {Math.round(v * 100)}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
