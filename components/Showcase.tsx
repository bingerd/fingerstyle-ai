"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { Song } from "@/lib/ir/schema";
import type { Tune } from "@/lib/tune/tune";
import type { Direction } from "@/lib/arrange/plan";
import { detectMoments } from "@/lib/eval/moments";
import data from "@/showcase/songs.json";
import { ChordTimeline } from "./ChordTimeline";
import { Moments } from "./Moments";
import { PracticePlan } from "./PracticePlan";
import { ReviewPanel } from "./Review";
import { ScoreView, type LoopRange } from "./ScoreView";
import { StudyNotes } from "./StudyNotes";

type Piece = { slug: string; song: Song; tune?: Tune; direction?: Direction };
const PIECES = data as unknown as Piece[];

/** The URL hash selects a piece (#slug), so every arrangement has a shareable link. */
function useHash() {
  return useSyncExternalStore(
    (cb) => { window.addEventListener("hashchange", cb); return () => window.removeEventListener("hashchange", cb); },
    () => decodeURIComponent(window.location.hash.slice(1)),
    () => "",
  );
}

const progressKey = (slug: string) => `fsai.progress.${slug}`;
function readProgress(slug: string): string[] {
  try { return JSON.parse(localStorage.getItem(progressKey(slug)) ?? "[]"); } catch { return []; }
}

/** Read-only public showcase (static export for GitHub Pages): browse pieces, play, practise. */
export function Showcase() {
  const hash = useHash();
  const piece = PIECES.find((p) => p.slug === hash) ?? null;
  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-24 sm:px-6">
      <header className="sticky top-0 z-20 -mx-4 mb-6 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <a href="#" className="focus-ring flex items-center gap-2 rounded-lg">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
            <rect x="1" y="1" width="26" height="26" rx="8" fill="var(--accent)" />
            {[8, 12, 16, 20].map((x) => <line key={x} x1={x} x2={x} y1="7" y2="21" stroke="var(--accent-ink)" strokeWidth="1.2" />)}
            <circle cx="12" cy="15" r="2" fill="var(--accent-ink)" /><circle cx="16" cy="18.5" r="2" fill="var(--accent-ink)" />
          </svg>
          <span className="font-display text-xl font-semibold tracking-tight">Fingerstyle AI</span>
        </a>
        <span className="hidden text-sm text-ink-3 sm:inline">tab showcase</span>
        <a href="https://github.com/bingerd/fingerstyle-ai" className="focus-ring ml-auto rounded-full border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2">Build your own on GitHub →</a>
      </header>
      {piece ? <PieceView key={piece.slug} piece={piece} /> : <Gallery />}
    </div>
  );
}

function Gallery() {
  return (
    <div className="rise">
      <p className="mb-2 text-sm font-medium tracking-widest text-accent uppercase">Solo guitar, reimagined</p>
      <h1 className="font-display text-5xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">Tabs worth filming.</h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-2">
        Full fingerstyle arrangements with playback, finger numbers, a live fretboard, the signature moments called out, and a practice path from first bar to camera-ready.
      </p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PIECES.map((p) => {
          const bars = p.song.sections.reduce((n, s) => n + s.bars.length, 0);
          const moments = detectMoments(p.song);
          return (
            <li key={p.slug}>
              <a href={`#${p.slug}`} className="card focus-ring flex h-full flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-md">
                <span className="text-xs font-medium tracking-widest text-accent uppercase">{p.direction?.name ?? p.song.style}</span>
                <span className="mt-1 font-display text-2xl leading-snug font-semibold">{p.song.title}</span>
                <span className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-2">{p.direction?.concept || p.song.summary}</span>
                <span className="mt-4 flex flex-wrap gap-1.5 text-[11px]">
                  {[p.song.style, p.song.key, `${p.song.tempo} bpm`, `${bars} bars`, p.song.difficulty, p.song.tuning !== "standard" ? p.song.tuning : "", p.song.capo ? `capo ${p.song.capo}` : ""]
                    .filter(Boolean).map((t) => <span key={t} className="max-w-full truncate rounded-full bg-surface-2 px-2 py-0.5 text-ink-2">{t}</span>)}
                </span>
                {moments.length > 0 && <span className="mt-3 text-xs text-ink-3">✦ {moments.slice(0, 3).map((m) => m.title.replace(/ \(.*\)$/, "")).join(" · ")}</span>}
              </a>
            </li>
          );
        })}
      </ul>
      <p className="mt-10 text-xs text-ink-3">Arranged with Fingerstyle AI. Traditional melodies and original pieces. Notation and playback by alphaTab.</p>
    </div>
  );
}

function PieceView({ piece }: { piece: Piece }) {
  const { song } = piece;
  const [loop, setLoop] = useState<LoopRange>(null);
  const [playRequest, setPlayRequest] = useState(0);
  const [speedRequest, setSpeedRequest] = useState<{ value: number; n: number } | undefined>(undefined);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mastered, setMastered] = useState<string[]>(() => (typeof window === "undefined" ? [] : readProgress(piece.slug)));
  const bars = useMemo(() => song.sections.reduce((n, s) => n + s.bars.length, 0), [song]);
  const practice = (range: { startBar: number; endBar: number }, speed: number) => {
    setLoop({ startBar: range.startBar, endBar: Math.min(bars - 1, Math.max(range.endBar, range.startBar + 1)) });
    setSpeedRequest((r) => ({ value: speed, n: (r?.n ?? 0) + 1 }));
    setPlayRequest((n) => n + 1);
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <main className="min-w-0 space-y-6">
        <section className="rise">
          <a href="#" className="text-sm text-ink-3 hover:text-ink">← All pieces</a>
          <div className="mt-3 mb-2 flex flex-wrap gap-2 text-xs">
            {[piece.direction?.name, song.style, song.key, `${song.tempo} bpm`, `${song.timeSignature.numerator}/${song.timeSignature.denominator}`, song.difficulty, song.tuning !== "standard" ? song.tuning : "", song.capo ? `capo ${song.capo}` : ""]
              .filter(Boolean).map((t) => <span key={t} className="rounded-full border border-line bg-surface px-2.5 py-1 font-medium text-ink-2">{t}</span>)}
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{song.title}</h1>
          <p className="mt-3 max-w-3xl text-[17px] leading-relaxed text-ink-2">{song.summary}</p>
        </section>
        <Moments song={song} onPractice={(m) => practice(m, m.speed)} />
        <ScoreView song={song} loop={loop} onLoopChange={setLoop} onActiveChord={setActiveId} onChordClick={() => {}} playRequest={playRequest} speedRequest={speedRequest} />
        <PracticePlan
          song={song} savedId={piece.slug} mastered={mastered} onPractice={practice}
          onProgress={(m) => { setMastered(m); try { localStorage.setItem(progressKey(piece.slug), JSON.stringify(m)); } catch {} }}
        />
        <section aria-labelledby="chart">
          <h2 id="chart" className="mb-3 font-display text-2xl font-semibold">Chord chart</h2>
          <ChordTimeline song={song} selectedId={null} activeId={activeId} changedIds={new Set()} onSelect={() => {}} />
        </section>
      </main>
      <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
        <ReviewPanel song={song} tune={piece.tune ?? null} direction={piece.direction ?? null} />
        <StudyNotes notes={song.tasteNotes} />
      </aside>
    </div>
  );
}
