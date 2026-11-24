"use client";

import { useEffect, useMemo, useState } from "react";
import type { SavedSong } from "@/lib/ir/schema";
import type { ClassTabEntry } from "@/lib/classtab";
import { Spinner } from "./Composer";
import { ScoreView, type LoopRange } from "./ScoreView";
import type { Song } from "@/lib/ir/schema";
import { rawFromMidi } from "@/lib/tune/importers";
import { guitarFromMidi, tuningFromText } from "@/lib/tune/toGuitar";

type Tab = "mine" | "classical";

export function LibraryView(props: {
  library: SavedSong[];
  activeId: string | null;
  onOpen: (s: SavedSong) => void;
  onDelete: (id: string) => void;
  onArrangeFile: (file: File) => void;
}) {
  const [tab, setTab] = useState<Tab>("mine");
  return (
    <div className="rise mx-auto max-w-[1440px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-sm font-medium tracking-widest text-accent uppercase">Library</p>
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Everything you can play</h1>
        </div>
        <div className="flex rounded-full border border-line p-0.5 text-sm" role="tablist" aria-label="Library section">
          {([["mine", `My arrangements · ${props.library.length}`], ["classical", "Classical (ClassTab)"]] as const).map(([v, label]) => (
            <button
              key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
              className={`focus-ring rounded-full px-4 py-1.5 transition ${tab === v ? "bg-ink text-bg font-semibold" : "text-ink-2 hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "mine" ? <Mine {...props} /> : <Classical onArrangeFile={props.onArrangeFile} />}
    </div>
  );
}

function Mine({ library, activeId, onOpen, onDelete }: { library: SavedSong[]; activeId: string | null; onOpen: (s: SavedSong) => void; onDelete: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [texture, setTexture] = useState<"all" | "fingerstyle" | "comping">("all");
  const [source, setSource] = useState<"all" | "file" | "memory">("all");
  const [sort, setSort] = useState<"new" | "title">("new");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return library
      .filter((s) => texture === "all" || s.song.texture === texture)
      .filter((s) => source === "all" || (source === "file") === !!s.tune)
      .filter((s) => !needle || [s.song.title, s.song.style, s.song.key, s.direction?.name ?? "", s.song.summary].join(" ").toLowerCase().includes(needle))
      .sort((a, b) => (sort === "title" ? a.song.title.localeCompare(b.song.title) : b.savedAt.localeCompare(a.savedAt)));
  }, [library, q, texture, source, sort]);

  if (!library.length)
    return <p className="card p-8 text-center text-ink-2">Nothing here yet. Every arrangement you generate is saved here automatically.</p>;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, style, key, direction…" aria-label="Search arrangements"
          className="focus-ring min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2 text-sm placeholder:text-ink-3 sm:max-w-sm"
        />
        <Pill value={texture} set={setTexture} options={[["all", "All"], ["fingerstyle", "Fingerstyle"], ["comping", "Comping"]]} />
        <Pill value={source} set={setSource} options={[["all", "Any source"], ["file", "Verified melody"], ["memory", "From memory"]]} />
        <Pill value={sort} set={setSort} options={[["new", "Newest"], ["title", "A–Z"]]} />
        <span className="ml-auto text-sm text-ink-3">{shown.length} shown</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((s) => (
          <li key={s.id} className={`card group relative flex flex-col p-4 transition hover:-translate-y-0.5 hover:shadow-md ${s.id === activeId ? "ring-2 ring-accent" : ""}`}>
            <button onClick={() => onOpen(s)} className="focus-ring flex flex-1 flex-col rounded-lg text-left">
              <span className="text-xs text-ink-3">{new Date(s.savedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
              <span className="mt-1 font-display text-lg leading-snug font-semibold">{s.song.title}</span>
              {s.direction?.name && <span className="text-sm text-accent">{s.direction.name}</span>}
              <span className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-2">{s.direction?.concept || s.song.summary}</span>
              <span className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                {[s.song.style, s.song.key, `${s.song.tempo} bpm`, s.song.difficulty, s.song.texture, s.song.capo ? `capo ${s.song.capo}` : "", s.song.tuning !== "standard" ? s.song.tuning : ""]
                  .filter(Boolean).map((t) => <span key={t} className="max-w-full truncate rounded-full bg-surface-2 px-2 py-0.5 text-ink-2">{t}</span>)}
                <span className={`rounded-full px-2 py-0.5 ${s.tune ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-warn/15 text-warn"}`}>
                  {s.tune ? (s.tune.source === "memory" ? "melody confirmed by ear" : "melody verified") : "from memory"}
                </span>
              </span>
            </button>
            <button
              onClick={() => onDelete(s.id)} aria-label={`Delete ${s.song.title}`}
              className="focus-ring absolute top-3 right-3 rounded px-1.5 py-0.5 text-xs text-ink-3 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-600"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Pill<T extends string>({ value, set, options }: { value: T; set: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex rounded-full border border-line p-0.5 text-xs">
      {options.map(([v, l]) => (
        <button key={v} aria-pressed={value === v} onClick={() => set(v)} className={`focus-ring rounded-full px-2.5 py-1 ${value === v ? "bg-surface-2 font-semibold text-ink" : "text-ink-2"}`}>{l}</button>
      ))}
    </div>
  );
}

function Classical({ onArrangeFile }: { onArrangeFile: (file: File) => void }) {
  const [entries, setEntries] = useState<ClassTabEntry[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [q, setQ] = useState("");
  const [composer, setComposer] = useState<string | null>(null);
  const [midiOnly, setMidiOnly] = useState(false);
  const [limit, setLimit] = useState(150);
  const [open, setOpen] = useState<{ entry: ClassTabEntry; text: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [size, setSize] = useState(14);
  const [mode, setMode] = useState<"play" | "text">("play");
  const [played, setPlayed] = useState<{ id: string; song: Song } | null>(null);
  const [loop, setLoop] = useState<LoopRange>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/classtab").then((r) => r.json()).then((d) => { setEntries(d.entries); setAvailable(d.available); });
  }, []);

  const composers = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries ?? []) m.set(e.composer, (m.get(e.composer) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (entries ?? [])
      .filter((e) => !composer || e.composer === composer)
      .filter((e) => !midiOnly || e.hasMidi)
      .filter((e) => !needle || `${e.title} ${e.composer} ${e.id}`.toLowerCase().includes(needle));
  }, [entries, q, composer, midiOnly]);

  async function read(e: ClassTabEntry) {
    setLoading(e.id);
    setError(null);
    try {
      const res = await fetch(`/api/classtab/${encodeURIComponent(e.id)}`);
      if (!res.ok) throw new Error("Couldn't open this tab");
      setOpen(await res.json());
      setLoop(null);
      setPlayed(null);
      if (e.hasMidi) await loadScore(e);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  }

  /** Turn the piece's MIDI into playable tab (deterministic string/fret assignment, no model). */
  async function loadScore(e: ClassTabEntry) {
    const res = await fetch(`/api/classtab/${encodeURIComponent(e.id)}?format=midi`);
    if (!res.ok) throw new Error("No MIDI for this piece");
    try {
      const raw = rawFromMidi(new Uint8Array(await res.arrayBuffer()), e.id);
      setPlayed({ id: e.id, song: guitarFromMidi(raw, { title: e.title, composer: e.composer, tuning: tuningFromText(e.tuning) }) });
    } catch (err) {
      throw new Error(`This piece's MIDI file can't be read (${err instanceof Error ? err.message : String(err)}). The text tab still works.`);
    }
  }

  async function arrange(e: ClassTabEntry) {
    setLoading(`midi:${e.id}`);
    setError(null);
    try {
      const res = await fetch(`/api/classtab/${encodeURIComponent(e.id)}?format=midi`);
      if (!res.ok) throw new Error("No MIDI for this piece");
      onArrangeFile(new File([await res.blob()], `${e.id}.mid`, { type: "audio/midi" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  }

  if (!available)
    return (
      <div className="card p-8 text-ink-2">
        <p className="font-semibold text-ink">The ClassTab catalogue isn&apos;t downloaded yet.</p>
        <p className="mt-2 text-sm">Run <code className="rounded bg-surface-2 px-1.5 py-0.5">npm run classtab:update</code> (about 14 MB, refreshed monthly by ClassTab), then reload.</p>
      </div>
    );
  if (!entries) return <p className="flex items-center gap-2 text-ink-2"><Spinner /> Loading catalogue…</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(280px,380px)_minmax(0,1fr)]">
      <aside className="card hidden max-h-[78vh] overflow-y-auto p-3 lg:block" aria-label="Composers">
        <button onClick={() => setComposer(null)} className={`focus-ring flex w-full justify-between rounded-lg px-2 py-1.5 text-sm ${!composer ? "bg-surface-2 font-semibold" : "hover:bg-surface-2"}`}>
          All composers <span className="text-ink-3">{entries.length}</span>
        </button>
        {composers.map(([c, n]) => (
          <button key={c} onClick={() => { setComposer(c); setLimit(150); }} className={`focus-ring flex w-full justify-between rounded-lg px-2 py-1 text-sm ${composer === c ? "bg-surface-2 font-semibold" : "text-ink-2 hover:bg-surface-2"}`}>
            <span className="truncate">{c}</span><span className="text-ink-3">{n}</span>
          </button>
        ))}
      </aside>

      <section className="card flex max-h-[78vh] flex-col p-3" aria-label="Pieces">
        <input
          value={q} onChange={(e) => { setQ(e.target.value); setLimit(150); }} placeholder="Search 4,000 pieces: Tárrega, Lágrima, BWV 996…" aria-label="Search ClassTab"
          className="focus-ring w-full rounded-full border border-line bg-surface-2 px-4 py-2 text-sm placeholder:text-ink-3"
        />
        <div className="mt-2 flex items-center justify-between px-1 text-xs text-ink-3">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={midiOnly} onChange={(e) => setMidiOnly(e.target.checked)} className="accent-[var(--accent)]" /> Only pieces I can arrange (MIDI)</label>
          <span>{filtered.length}</span>
        </div>
        {composer && <button onClick={() => setComposer(null)} className="mt-2 self-start rounded-full bg-accent-soft px-2.5 py-0.5 text-xs">{composer} ✕</button>}
        <ul className="-mx-1 mt-2 flex-1 overflow-y-auto">
          {filtered.slice(0, limit).map((e) => (
            <li key={e.id}>
              <button onClick={() => read(e)} className={`focus-ring w-full rounded-lg px-2 py-2 text-left ${open?.entry.id === e.id ? "bg-surface-2" : "hover:bg-surface-2"}`}>
                <span className="block truncate text-sm font-medium">{e.title}</span>
                <span className="flex gap-2 text-xs text-ink-3">
                  <span className="truncate">{e.composer}{e.tuning && !/^(standard|e\s*a\s*d\s*g\s*b\s*e)/i.test(e.tuning) ? ` · ${e.tuning}` : ""}</span>
                  {e.hasMidi && <span className="shrink-0 text-accent">♪ MIDI</span>}
                  {loading === e.id && <Spinner />}
                </span>
              </button>
            </li>
          ))}
          {filtered.length > limit && (
            <li><button onClick={() => setLimit((l) => l + 300)} className="focus-ring w-full py-2 text-sm text-accent">Show more ({filtered.length - limit})</button></li>
          )}
        </ul>
      </section>

      <section className="card flex max-h-[78vh] min-w-0 flex-col" aria-label="Tab reader">
        {open ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-xl font-semibold">{open.entry.title}</h2>
                <p className="text-xs text-ink-3">
                  {open.entry.composer}{open.entry.tuning ? ` · tuning ${open.entry.tuning}` : ""}{open.entry.unchecked ? " · unchecked by ClassTab" : ""}
                </p>
              </div>
              {open.entry.hasMidi && (
                <div className="flex rounded-full border border-line p-0.5 text-sm" role="tablist" aria-label="Reader mode">
                  {(["play", "text"] as const).map((m) => (
                    <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`focus-ring rounded-full px-3 py-1 ${mode === m ? "bg-ink text-bg font-semibold" : "text-ink-2"}`}>
                      {m === "play" ? "♪ Play" : "Text tab"}
                    </button>
                  ))}
                </div>
              )}
              <span className={`items-center gap-1 text-sm text-ink-2 ${mode === "text" || !open.entry.hasMidi ? "flex" : "hidden"}`}>
                <button onClick={() => setSize((s) => Math.max(10, s - 1))} className="focus-ring h-8 w-8 rounded-full border border-line" aria-label="Smaller text">−</button>
                <button onClick={() => setSize((s) => Math.min(24, s + 1))} className="focus-ring h-8 w-8 rounded-full border border-line" aria-label="Larger text">+</button>
              </span>
              {open.entry.hasMidi ? (
                <button onClick={() => arrange(open.entry)} disabled={!!loading} className="focus-ring flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50">
                  {loading === `midi:${open.entry.id}` ? <Spinner /> : "✦"} Arrange from MIDI
                </button>
              ) : (
                <span className="text-xs text-ink-3" title="Without MIDI the melody can't be imported">No MIDI to arrange from</span>
              )}
            </div>
            {mode === "play" && open.entry.hasMidi ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {played?.id === open.entry.id ? (
                  <>
                    <p className="mb-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
                      Notes and rhythm come from the piece&apos;s MIDI file. Strings and frets are computed automatically and may differ from the transcriber&apos;s fingering; compare with the text tab.
                    </p>
                    <ScoreView song={played.song} loop={loop} onLoopChange={setLoop} onActiveChord={() => {}} onChordClick={() => {}} />
                  </>
                ) : error ? (
                  <p className="p-6 text-sm text-red-600">{error}</p>
                ) : (
                  <p className="flex items-center gap-2 p-6 text-ink-2"><Spinner /> Building the score…</p>
                )}
              </div>
            ) : (
              <pre className="flex-1 overflow-auto bg-paper p-5 font-mono leading-[1.35] text-black" style={{ fontSize: size }}>{open.text}</pre>
            )}
            <p className="border-t border-line px-4 py-2 text-[11px] text-ink-3">
              From <a className="underline" href="https://www.classtab.org/" target="_blank" rel="noreferrer">ClassTab.org</a>: tabs by their transcribers, kept on your computer for personal study.
            </p>
          </>
        ) : (
          <div className="m-auto max-w-sm p-8 text-center text-ink-2">
            <p className="font-display text-2xl font-semibold text-ink">{entries.length.toLocaleString()} classical pieces</p>
            <p className="mt-2 text-sm">Pick a piece to read its tab. Pieces marked <span className="text-accent">♪ MIDI</span> can also be arranged: their melody is imported and checked note by note.</p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
