"use client";

import { useMemo } from "react";
import type { Song } from "@/lib/ir/schema";
import type { Tune } from "@/lib/tune/tune";
import type { ArrangementPlan, Direction } from "@/lib/arrange/plan";
import { reviewSong, type Review, type Status } from "@/lib/eval/review";
import type { Issue } from "@/lib/theory/validate";
import { Spinner } from "./Composer";

export type Candidate = { id: string; direction: Direction; song: Song; warnings: Issue[]; repairs: number; review: Review; savedId: string | null };

const STATUS: Record<Status, { label: string; cls: string; title: string }> = {
  verified: { label: "Verified", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", title: "Checked against ground truth (your file / the theory checker)" },
  heuristic: { label: "Estimated", cls: "bg-surface-2 text-ink-2", title: "Measured from the tab with rules of thumb; no human hand or ear involved" },
  unverified: { label: "Unverified", cls: "bg-warn/15 text-warn", title: "Can't be checked with the information available" },
};

const Bar = ({ value }: { value: number }) => (
  <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
    <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(value * 100)}%` }} />
  </span>
);

/** Distinct arrangements side by side: what each is going for, how it scores, and a way to hear it. */
export function Alternatives(props: {
  candidates: Candidate[];
  activeId: string | null;
  busy: boolean;
  analysis: ArrangementPlan["analysis"] | null;
  failed: number;
  onListen: (c: Candidate) => void;
  onRegenerate: (d: Direction) => void;
  onMore: () => void;
}) {
  const { candidates, activeId } = props;
  return (
    <section aria-labelledby="alts" className="rise">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="alts" className="font-display text-2xl font-semibold">Alternatives</h2>
        <p className="text-sm text-ink-3">Ranked by the musical review below. Listen to them all; your ears decide.</p>
      </div>
      {props.analysis && (
        <details className="mb-3 rounded-xl border border-line bg-surface px-4 py-2 text-sm">
          <summary className="cursor-pointer text-ink-2">How the AI read the song</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1.5 pb-1 sm:grid-cols-[110px_1fr]">
            {(["mood", "melody", "harmony", "rhythm", "hooks"] as const).map((k) => (
              <div key={k} className="contents">
                <dt className="text-xs font-medium tracking-widest text-ink-3 uppercase sm:pt-0.5">{k}</dt>
                <dd className="text-ink-2">{props.analysis![k]}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {candidates.map((c, i) => {
          const on = c.id === activeId;
          return (
            <article key={c.id} className={`card flex flex-col p-4 transition ${on ? "ring-2 ring-accent" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium tracking-widest text-ink-3 uppercase">{i === 0 ? "Top ranked" : `Option ${i + 1}`}</p>
                  <h3 className="font-display text-lg leading-tight font-semibold">{c.direction.name}</h3>
                </div>
                <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-sm" title="Overall review score">{Math.round(c.review.overall * 100)}</span>
              </div>
              <p className="mt-1 text-xs text-ink-3">
                {c.direction.style} · {c.direction.flair} · {c.direction.difficulty} · reharm {c.direction.reharm} · melody {c.direction.fidelity}
              </p>
              {c.direction.concept && <p className="mt-2 text-sm leading-relaxed text-ink-2">{c.direction.concept}</p>}
              <ul className="mt-3 space-y-1.5">
                {c.review.criteria.filter((k) => k.score !== null).slice(0, 5).map((k) => (
                  <li key={k.key} className="grid grid-cols-[1fr_80px] items-center gap-2 text-xs text-ink-2">
                    <span className="truncate">{k.label}</span>
                    <Bar value={k.score!} />
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex gap-2 pt-4">
                <button onClick={() => props.onListen(c)} className={`focus-ring h-9 flex-1 rounded-xl text-sm font-semibold ${on ? "bg-ink text-bg" : "bg-accent text-accent-ink"}`}>
                  {on ? "▶ Play again" : "▶ Listen & open"}
                </button>
                <button onClick={() => props.onRegenerate(c.direction)} disabled={props.busy} className="focus-ring h-9 rounded-xl border border-line px-3 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-40" title="Write a fresh take in this direction">
                  Retake
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <button onClick={props.onMore} disabled={props.busy} className="focus-ring flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-ink-2 hover:bg-surface-2 disabled:opacity-40">
          {props.busy ? <><Spinner /> Writing…</> : "↻ New set of alternatives"}
        </button>
        {props.failed > 0 && <span className="text-warn">{props.failed} direction{props.failed > 1 ? "s" : ""} failed to generate and {props.failed > 1 ? "were" : "was"} left out.</span>}
      </div>
    </section>
  );
}

/** Live review of the arrangement on screen; recomputed after every edit. */
export function ReviewPanel({ song, tune, direction }: { song: Song; tune: Tune | null; direction: Direction | null }) {
  const review = useMemo(() => reviewSong(song, { tune, prefs: direction ?? undefined }), [song, tune, direction]);
  const melody = review.criteria.find((c) => c.key === "melody");
  return (
    <section aria-labelledby="review" className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="review" className="font-display text-2xl font-semibold">Musical review</h2>
        <span className="font-mono text-sm text-ink-2" title="Weighted mean of the scored criteria, minus checker errors">
          {Math.round(review.overall * 100)} / 100
        </span>
      </div>
      {melody && (
        <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${melody.status === "verified" ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "bg-warn/10 text-warn"}`}>
          <b>{melody.status === "verified" ? `Melody checked ${tune?.source === "memory" ? "against the melody you confirmed" : "against your file"}: ${Math.round((melody.score ?? 0) * 100)}%.` : "Melody not verified."}</b>{" "}
          {melody.detail}
        </p>
      )}
      <ul className="mt-4 divide-y divide-line">
        {review.criteria.filter((c) => c.key !== "melody").map((c) => (
          <li key={c.key} className="grid gap-1 py-2.5 sm:grid-cols-[170px_1fr_90px] sm:items-center sm:gap-4">
            <span className="flex items-center gap-2 text-sm font-medium">
              {c.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${STATUS[c.status].cls}`} title={STATUS[c.status].title}>{STATUS[c.status].label}</span>
            </span>
            <span className="text-sm text-ink-2">{c.detail}</span>
            {c.score !== null ? <Bar value={c.score} /> : <span className="text-xs text-ink-3">not scored</span>}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-ink-3">
        {review.errors > 0 && <b className="text-warn">{review.errors} theory-checker error{review.errors > 1 ? "s" : ""} remain. </b>}
        Scores come from rules (chord tones, fret spans, voice movement), not from listening. Fingerings are estimated and not tested by a real hand.
        Spot a wrong note or an awkward grip? Click the chord to swap it, or use <b>Revise</b>, for example “bar 3: melody should be E D C” or “bar 6 is too much of a stretch”.
      </p>
    </section>
  );
}
