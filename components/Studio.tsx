"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReharmOption, SavedSong, Song } from "@/lib/ir/schema";
import { DEMO_SONG } from "@/lib/ir/demo";
import { findChord, replaceChord } from "@/lib/ir/edit";
import { chordBarIndex } from "@/lib/alphatex/fromIR";
import type { Issue } from "@/lib/theory/validate";
import type { Tune } from "@/lib/tune/tune";
import { Composer, Spinner, type ComposerInput } from "./Composer";
import { ChordTimeline } from "./ChordTimeline";
import { ReharmPanel } from "./ReharmPanel";
import { ScoreView, type LoopRange } from "./ScoreView";
import { StudyNotes } from "./StudyNotes";
import { Alternatives, ReviewPanel, type Candidate } from "./Review";
import type { ArrangementPlan, Direction } from "@/lib/arrange/plan";

type Preview = { chordId: string; option: ReharmOption; index: number };
export type ProviderId = "claude" | "codex" | "anthropic-api";
const PROVIDER_LABEL: Record<ProviderId, string> = { claude: "Claude", codex: "Codex", "anthropic-api": "Claude API" };

export function Studio() {
  const [song, setSong] = useState<Song | null>(null);
  const [history, setHistory] = useState<{ song: Song; changed: Set<string> }[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastInput, setLastInput] = useState<ComposerInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Issue[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loop, setLoop] = useState<LoopRange>(null);
  const [playRequest, setPlayRequest] = useState(0);
  const [refine, setRefine] = useState("");
  const [library, setLibrary] = useState<SavedSong[]>([]);
  const [showComposer, setShowComposer] = useState(false);
  const [tune, setTune] = useState<Tune | null>(null);
  const [provider, setProviderState] = useState<ProviderId>("claude");
  const [available, setAvailable] = useState<Record<ProviderId, boolean> | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [activeCandidate, setActiveCandidate] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ArrangementPlan["analysis"] | null>(null);
  const [failed, setFailed] = useState(0);
  const [direction, setDirection] = useState<Direction | null>(null);

  useEffect(() => {
    fetch("/api/providers").then((r) => r.json()).then((a: Record<ProviderId, boolean>) => {
      setAvailable(a);
      let saved: string | null = null;
      try { saved = localStorage.getItem("woodshed.provider"); } catch {}
      const pick = saved && a[saved as ProviderId] ? (saved as ProviderId) : (["claude", "codex", "anthropic-api"] as const).find((p) => a[p]);
      if (pick) setProviderState(pick);
    });
  }, []);
  function setProvider(p: ProviderId) {
    setProviderState(p);
    try { localStorage.setItem("woodshed.provider", p); } catch {}
  }

  const refreshLibrary = useCallback(async () => {
    const res = await fetch("/api/songs");
    if (res.ok) setLibrary((await res.json()).songs);
  }, []);
  useEffect(() => {
    fetch("/api/songs").then((r) => (r.ok ? r.json() : { songs: [] })).then((d) => setLibrary(d.songs));
  }, []);

  const displaySong = useMemo(
    () => (song && preview ? replaceChord(song, preview.chordId, preview.option.chords, preview.option.beats) : song),
    [song, preview],
  );
  const selected = song && selectedId ? findChord(song, selectedId)?.chord ?? null : null;

  function loadSong(next: Song, opts: { saved?: string | null; keepHistory?: boolean } = {}) {
    if (song && opts.keepHistory) setHistory((h) => [...h.slice(-30), { song, changed: changedIds }]);
    else if (!opts.keepHistory) setHistory([]);
    setSong(next);
    setSelectedId(null);
    setPreview(null);
    setLoop(null);
    setShowComposer(false);
    if (opts.saved !== undefined) setSavedId(opts.saved);
    if (!opts.keepHistory) setChangedIds(new Set());
    setDirty(!opts.saved);
  }

  /**
   * new:      plan + write `alternatives` arrangements, replace the candidate list
   * retake:   one fresh take of a given direction, added to the list
   * revise:   change the arrangement on screen (keeps undo history)
   */
  async function arrange(input: ComposerInput, mode: { kind: "new" } | { kind: "retake"; direction: Direction } | { kind: "revise"; existing: Song } = { kind: "new" }) {
    setBusy(true);
    setError(null);
    const existing = mode.kind === "revise" ? mode.existing : undefined;
    const keepTune = mode.kind !== "new" ? tune ?? undefined : undefined;
    try {
      const res = await fetch("/api/arrange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input, existing, provider, tune: input.tune ?? keepTune,
          direction: mode.kind === "retake" ? mode.direction : mode.kind === "revise" ? direction ?? undefined : undefined,
          alternatives: mode.kind === "new" ? input.alternatives : 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      const got: Candidate[] = data.candidates;
      const best = got[0];
      setWarnings(best.warnings ?? []);
      setDirection(best.direction);
      refreshLibrary();
      if (mode.kind === "revise") {
        loadSong(best.song, { keepHistory: true, saved: best.savedId });
      } else {
        setLastInput(input);
        if (mode.kind === "new") {
          setCandidates(got);
          setAnalysis(data.analysis ?? null);
          setFailed(data.failed?.length ?? 0);
          setTune(input.tune ?? null);
          loadSong(best.song, { saved: best.savedId });
        } else {
          setCandidates((cs) => [...cs, ...got].sort((a, b) => b.review.overall - a.review.overall));
          loadSong(best.song, { keepHistory: true, saved: best.savedId });
        }
        setActiveCandidate(best.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function listen(c: Candidate) {
    if (c.id !== activeCandidate) {
      loadSong(c.song, { keepHistory: true, saved: c.savedId });
      setDirection(c.direction);
      setWarnings(c.warnings);
      setActiveCandidate(c.id);
    }
    setPlayRequest((n) => n + 1);
  }

  function openSaved(s: SavedSong) {
    loadSong(s.song, { saved: s.id });
    setTune(s.tune ?? null);
    setDirection(s.direction ?? null);
    setCandidates([]);
    setAnalysis(null);
    setActiveCandidate(null);
    setWarnings([]);
  }

  function selectChord(id: string) {
    setSelectedId((cur) => (cur === id ? null : id));
    setPreview(null);
  }

  function startPreview(option: ReharmOption | null, index: number | null) {
    if (!song || !selectedId || !option || index === null) {
      setPreview(null);
      setLoop(null);
      return;
    }
    const bar = chordBarIndex(song).get(selectedId) ?? 0;
    setPreview({ chordId: selectedId, option, index });
    setLoop({ startBar: Math.max(0, bar - 1), endBar: bar + 1 });
    setPlayRequest((n) => n + 1);
  }

  function applyOption(option: ReharmOption) {
    if (!song || !selectedId) return;
    const next = replaceChord(song, selectedId, option.chords, option.beats);
    const before = new Set(song.sections.flatMap((s) => s.bars.flatMap((b) => b.chords.map((c) => c.id))));
    const added = next.sections.flatMap((s) => s.bars.flatMap((b) => b.chords.map((c) => c.id))).filter((id) => !before.has(id) || id === selectedId);
    setHistory((h) => [...h.slice(-30), { song, changed: changedIds }]);
    setSong(next);
    setChangedIds((s) => new Set([...s, ...added]));
    setPreview(null);
    setLoop(null);
    setSelectedId(null);
    setDirty(true);
  }

  function undo() {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setSong(prev.song);
    setChangedIds(prev.changed);
    setPreview(null);
    setSelectedId(null);
    setDirty(true);
  }

  async function save() {
    if (!song) return;
    const res = await fetch("/api/songs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song, id: savedId ?? undefined, tune: tune ?? undefined, direction: direction ?? undefined }),
    });
    if (res.ok) {
      const entry: SavedSong = await res.json();
      setSavedId(entry.id);
      setDirty(false);
      refreshLibrary();
    }
  }

  async function remove(id: string) {
    await fetch(`/api/songs/${id}`, { method: "DELETE" });
    if (id === savedId) setSavedId(null);
    refreshLibrary();
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-24 sm:px-6">
      <header className="sticky top-0 z-20 -mx-4 mb-6 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <button onClick={() => { setSong(null); setSelectedId(null); }} className="focus-ring flex items-center gap-2 rounded-lg" aria-label="Home">
          <Logo />
          <span className="font-display text-xl font-semibold tracking-tight">Fingerstyle AI</span>
        </button>
        <span className="hidden text-sm text-ink-3 sm:inline">arrange · reharmonize · study</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-full border border-line p-0.5 text-sm" role="radiogroup" aria-label="Model">
            {(Object.keys(PROVIDER_LABEL) as ProviderId[])
              .filter((p) => p !== "anthropic-api" || available?.["anthropic-api"])
              .map((p) => (
                <button
                  key={p} role="radio" aria-checked={provider === p}
                  disabled={available ? !available[p] : false}
                  title={available && !available[p] ? `${PROVIDER_LABEL[p]} CLI not found` : `Use your ${PROVIDER_LABEL[p]} login`}
                  onClick={() => setProvider(p)}
                  className={`focus-ring rounded-full px-3 py-1.5 transition disabled:opacity-35 ${provider === p ? "bg-accent text-accent-ink font-semibold" : "text-ink-2 hover:text-ink"}`}
                >
                  {PROVIDER_LABEL[p]}
                </button>
              ))}
          </div>
          {song && (
            <>
              {lastInput && direction && (
                <button onClick={() => arrange(lastInput, { kind: "retake", direction })} disabled={busy} title="Write a fresh take in the same direction and add it to the alternatives" className="focus-ring hidden h-9 rounded-full border border-line px-3 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-40 sm:block">
                  Regenerate
                </button>
              )}
              <button onClick={undo} disabled={!history.length} className="focus-ring h-9 rounded-full border border-line px-3 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-40">
                Undo
              </button>
              <button onClick={save} disabled={!dirty} className="focus-ring h-9 rounded-full border border-line px-3 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-40">
                {dirty ? "Save" : "Saved"}
              </button>
              <button onClick={() => { setShowComposer((v) => !v); setSelectedId(null); }} className="focus-ring h-9 rounded-full bg-ink px-4 text-sm font-semibold text-bg">
                New
              </button>
            </>
          )}
        </div>
      </header>

      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {error}
          <button onClick={() => setError(null)} className="font-medium underline">Dismiss</button>
        </div>
      )}

      {!song ? (
        <Landing busy={busy} onSubmit={(i) => arrange(i)} onDemo={() => openSaved({ id: "", savedAt: "", song: DEMO_SONG })} library={library} onOpen={openSaved} onDelete={remove} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <main className="min-w-0 space-y-6">
            {candidates.length > 1 && (
              <Alternatives
                candidates={candidates}
                activeId={activeCandidate}
                busy={busy}
                analysis={analysis}
                failed={failed}
                onListen={listen}
                onRegenerate={(d) => lastInput && arrange(lastInput, { kind: "retake", direction: d })}
                onMore={() => lastInput && arrange(lastInput)}
              />
            )}

            <SongHeader song={song} />

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!refine.trim()) return;
                arrange(
                  {
                    request: refine, style: song.style, difficulty: song.difficulty, position: lastInput?.position ?? "No preference", texture: song.texture,
                    flair: direction?.flair ?? "auto", reharm: direction?.reharm ?? "auto", fidelity: direction?.fidelity ?? "auto", alternatives: 1,
                  },
                  { kind: "revise", existing: song },
                );
                setRefine("");
              }}
              className="card flex items-center gap-2 p-2 pl-4"
            >
              <span className="text-sm text-ink-3" aria-hidden>✦</span>
              <input
                value={refine}
                onChange={(e) => setRefine(e.target.value)}
                disabled={busy}
                placeholder="Ask for changes: “add a turnaround”, “make bar 4 darker”, “simpler for beginners”"
                className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none placeholder:text-ink-3"
                aria-label="Ask for changes to this arrangement"
              />
              <button disabled={busy || !refine.trim()} className="focus-ring flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-bg disabled:opacity-40">
                {busy ? <><Spinner /> Revising…</> : "Revise"}
              </button>
            </form>

            {warnings.length > 0 && (
              <details className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-2 text-sm">
                <summary className="cursor-pointer text-warn">{warnings.length} note{warnings.length > 1 ? "s" : ""} from the theory checker</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
                  {warnings.map((w, i) => <li key={i}>{w.where}: {w.message}</li>)}
                </ul>
              </details>
            )}

            <section aria-labelledby="chart">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 id="chart" className="font-display text-2xl font-semibold">Chord chart</h2>
                <p className="text-sm text-ink-3">Click any chord to reharmonize it</p>
              </div>
              <ChordTimeline song={displaySong!} selectedId={selectedId} activeId={activeId} changedIds={changedIds} onSelect={selectChord} />
            </section>

            <ScoreView
              song={displaySong!}
              loop={loop}
              onLoopChange={setLoop}
              onActiveChord={setActiveId}
              onChordClick={(id) => { setSelectedId(id); setPreview(null); }}
              playRequest={playRequest}
            />

            <ReviewPanel song={displaySong!} tune={tune} direction={direction} />

            <StudyNotes notes={song.tasteNotes} />
          </main>

          <div className="lg:sticky lg:top-20 lg:self-start">
            {selected ? (
              <ReharmPanel
                key={selected.id}
                song={song}
                chord={selected}
                provider={provider}
                tune={tune}
                fidelity={direction?.fidelity ?? "exact"}
                previewIndex={preview?.index ?? null}
                onPreview={startPreview}
                onApply={applyOption}
                onClose={() => { setSelectedId(null); setPreview(null); setLoop(null); }}
              />
            ) : showComposer ? (
              <Composer busy={busy} onSubmit={(i) => arrange(i)} />
            ) : (
              <SidePanel library={library} onOpen={openSaved} onDelete={remove} activeId={savedId} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SongHeader({ song }: { song: Song }) {
  const ts = `${song.timeSignature.numerator}/${song.timeSignature.denominator}`;
  return (
    <section className="rise">
      <div className="mb-2 flex flex-wrap gap-2 text-xs">
        {[song.style, song.key, `${song.tempo} bpm`, ts, song.difficulty[0].toUpperCase() + song.difficulty.slice(1)].map((t) => (
          <span key={t} className="rounded-full border border-line bg-surface px-2.5 py-1 font-medium text-ink-2">{t}</span>
        ))}
      </div>
      <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{song.title}</h1>
      <p className="mt-3 max-w-3xl text-[17px] leading-relaxed text-ink-2">{song.summary}</p>
    </section>
  );
}

function SidePanel({ library, onOpen, onDelete, activeId }: { library: SavedSong[]; onOpen: (s: SavedSong) => void; onDelete: (id: string) => void; activeId: string | null }) {
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <p className="text-xs font-medium tracking-widest text-ink-3 uppercase">How to study</p>
        <ol className="mt-3 space-y-3 text-sm leading-relaxed text-ink-2">
          <li><b className="text-ink">1. Listen.</b> Press play, then slow it to 60–70% and follow the cursor.</li>
          <li><b className="text-ink">2. Loop.</b> Loop a tricky bar until the change feels automatic.</li>
          <li><b className="text-ink">3. Reharmonize.</b> Click a chord, preview substitutions in context, and keep the ones you like.</li>
          <li><b className="text-ink">4. Revise.</b> Ask for a different feel, an easier version or a new section.</li>
        </ol>
      </div>
      <Library library={library} onOpen={onOpen} onDelete={onDelete} activeId={activeId} />
    </div>
  );
}

function Library({ library, onOpen, onDelete, activeId }: { library: SavedSong[]; onOpen: (s: SavedSong) => void; onDelete: (id: string) => void; activeId?: string | null }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? library.filter((s) => [s.song.title, s.song.style, s.song.key, s.direction?.name ?? ""].join(" ").toLowerCase().includes(needle))
    : library;
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-xs font-medium tracking-widest text-ink-3 uppercase">Your library</p>
        {library.length > 0 && <span className="text-xs text-ink-3">{library.length} arrangement{library.length > 1 ? "s" : ""}</span>}
      </div>
      {library.length === 0 ? (
        <p className="text-sm text-ink-3">Every arrangement you generate is stored here automatically.</p>
      ) : (
        <>
          {library.length > 5 && (
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, style, key…" aria-label="Search library"
              className="focus-ring mb-2 w-full rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm placeholder:text-ink-3"
            />
          )}
          <ul className="-mx-2 max-h-[60vh] space-y-0.5 overflow-y-auto">
            {shown.map((s) => (
              <li key={s.id} className={`group flex items-center rounded-lg ${s.id === activeId ? "bg-surface-2" : "hover:bg-surface-2"}`}>
                <button onClick={() => onOpen(s)} className="focus-ring min-w-0 flex-1 px-2 py-2 text-left">
                  <span className="block truncate font-medium">{s.song.title}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {s.direction?.name ? `${s.direction.name} · ` : ""}{s.song.style} · {s.song.key}{s.tune ? " · from file" : ""} · {new Date(s.savedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </button>
                <button onClick={() => onDelete(s.id)} className="focus-ring mr-1 rounded p-1.5 text-xs text-ink-3 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-600" aria-label={`Delete ${s.song.title}`}>
                  Delete
                </button>
              </li>
            ))}
            {!shown.length && <li className="px-2 py-2 text-sm text-ink-3">No matches.</li>}
          </ul>
        </>
      )}
    </div>
  );
}

function Landing(props: { busy: boolean; onSubmit: (i: ComposerInput) => void; onDemo: () => void; library: SavedSong[]; onOpen: (s: SavedSong) => void; onDelete: (id: string) => void }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 pt-6 lg:grid-cols-[1fr_520px] lg:pt-14">
      <div className="rise">
        <p className="mb-4 text-sm font-medium tracking-widest text-accent uppercase">Your practice room</p>
        <h1 className="font-display text-5xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
          Any progression,<br />any style,<br /><em className="font-normal text-accent">played with taste.</em>
        </h1>
        <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-2">
          Describe what you want to play. Fingerstyle AI writes a playable arrangement with tab, notation, chord grips and playback, and explains the choices.
          Click any chord to hear reharmonizations in context.
        </p>
        <button onClick={props.onDemo} className="focus-ring mt-6 rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-surface">
          Open the demo (no API key needed) →
        </button>
        <div className="mt-10 max-w-lg">
          <Library library={props.library} onOpen={props.onOpen} onDelete={props.onDelete} />
        </div>
      </div>
      <div className="rise" style={{ animationDelay: "80ms" }}>
        <Composer busy={props.busy} onSubmit={props.onSubmit} />
      </div>
    </div>
  );
}

const Logo = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
    <rect x="1" y="1" width="26" height="26" rx="8" fill="var(--accent)" />
    {[8, 12, 16, 20].map((x) => <line key={x} x1={x} x2={x} y1="7" y2="21" stroke="var(--accent-ink)" strokeWidth="1.2" />)}
    <line x1="7" x2="21" y1="11" y2="11" stroke="var(--accent-ink)" strokeWidth="1.6" />
    <circle cx="12" cy="15" r="2" fill="var(--accent-ink)" />
    <circle cx="16" cy="18.5" r="2" fill="var(--accent-ink)" />
  </svg>
);
