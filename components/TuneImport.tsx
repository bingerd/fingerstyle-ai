"use client";

import { useMemo, useState } from "react";
import { guessMelodyTrack, midiName, toTune, type RawScore, type Tune } from "@/lib/tune/tune";
import { rawFromAlphaTab, rawFromMidi } from "@/lib/tune/importers";
import { loadAlphaTab } from "@/lib/client/alphatab";

const SCORE_EXT = /\.(gp|gp3|gp4|gp5|gpx|musicxml|xml|mxl|cap|capx)$/i;
const MIDI_EXT = /\.(mid|midi)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg)$/i;

async function rawFromFile(file: File): Promise<RawScore> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.replace(/\.[^.]+$/, "");
  if (MIDI_EXT.test(file.name)) return rawFromMidi(bytes, name);
  if (SCORE_EXT.test(file.name)) {
    const at = await loadAlphaTab();
    return rawFromAlphaTab(at.importer.ScoreLoader.loadScoreFromBytes(bytes), name);
  }
  if (AUDIO_EXT.test(file.name)) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/transcribe", { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Audio transcription failed");
    return rawFromMidi(new Uint8Array(await res.arrayBuffer()), name);
  }
  throw new Error("Unsupported file. Use MIDI, Guitar Pro, MusicXML or an audio file.");
}

/** Pick a file → choose the melody track and bar range → hands a Tune to the composer. */
export function TuneImport({ tune, onTune }: { tune: Tune | null; onTune: (t: Tune | null) => void }) {
  const [raw, setRaw] = useState<RawScore | null>(null);
  const [track, setTrack] = useState(0);
  const [fromBar, setFromBar] = useState(1);
  const [barCount, setBarCount] = useState(16);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalBars = useMemo(() => {
    if (!raw) return 0;
    const barTicks = raw.timeSignature.numerator * (4 / raw.timeSignature.denominator) * raw.ppq;
    const last = Math.max(0, ...raw.tracks.flatMap((t) => t.notes.map((n) => n.tick + n.durTicks)));
    return Math.max(1, Math.ceil(last / barTicks));
  }, [raw]);

  function rebuild(r: RawScore, t: number, from: number, count: number) {
    const tn = toTune(r, t, from - 1, count);
    onTune(tn.bars.some((b) => b.melody.length) ? tn : null);
  }

  async function onFile(file: File) {
    setError(null);
    setLoading(AUDIO_EXT.test(file.name) ? "Transcribing audio. This can take a minute…" : "Reading file…");
    try {
      const r = await rawFromFile(file);
      const t = guessMelodyTrack(r);
      setRaw(r);
      setTrack(t);
      setFromBar(1);
      setBarCount(16);
      rebuild(r, t, 1, 16);
    } catch (e) {
      setError((e as Error).message);
      setRaw(null);
      onTune(null);
    } finally {
      setLoading(null);
    }
  }

  const preview = tune?.bars.slice(0, 4).map((b) => b.melody.map((n) => midiName(n.midi)).join(" ") || "–");

  return (
    <div className="space-y-3">
      <label
        className="focus-within:ring-accent flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-surface-2 px-4 py-5 text-center transition hover:border-accent"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      >
        <span className="font-medium">{raw ? "Load a different file" : "Drop a tune file or click to choose"}</span>
        <span className="text-xs text-ink-3">MIDI · Guitar Pro · MusicXML · or audio (MP3/WAV)</span>
        <input
          type="file"
          className="sr-only"
          accept=".mid,.midi,.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.xml,.mxl,.mp3,.wav,.m4a,.aac,.flac,.ogg"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
        />
      </label>

      {loading && <p className="text-sm text-ink-2">{loading}</p>}
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-700 dark:text-red-300">{error}</p>}

      {raw && (
        <div className="space-y-3 rounded-xl border border-line p-3">
          <p className="font-medium">{raw.title} <span className="text-sm font-normal text-ink-3">· {totalBars} bars · {raw.timeSignature.numerator}/{raw.timeSignature.denominator} · {Math.round(raw.tempo)} bpm</span></p>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium tracking-widest text-ink-3 uppercase">Melody track</span>
            <select
              value={track}
              onChange={(e) => { const t = Number(e.target.value); setTrack(t); rebuild(raw, t, fromBar, barCount); }}
              className="focus-ring w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5"
            >
              {raw.tracks.map((t, i) => (
                <option key={i} value={i} disabled={!t.notes.length}>{t.name} ({t.notes.length} notes)</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label>
              <span className="mb-1 block text-xs font-medium tracking-widest text-ink-3 uppercase">From bar</span>
              <input
                type="number" min={1} max={totalBars} value={fromBar}
                onChange={(e) => { const v = Math.min(totalBars, Math.max(1, Number(e.target.value) || 1)); setFromBar(v); rebuild(raw, track, v, barCount); }}
                className="focus-ring w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5"
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium tracking-widest text-ink-3 uppercase">Bars (max 32)</span>
              <input
                type="number" min={1} max={32} value={barCount}
                onChange={(e) => { const v = Math.min(32, Math.max(1, Number(e.target.value) || 1)); setBarCount(v); rebuild(raw, track, fromBar, v); }}
                className="focus-ring w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5"
              />
            </label>
          </div>
          {tune ? (
            <p className="font-mono text-xs leading-relaxed text-ink-2">
              Melody: {preview?.map((p, i) => <span key={i} className="mr-2">|{p}</span>)}…
            </p>
          ) : (
            <p className="text-sm text-warn">No melody notes in that range. Try another track or bar range.</p>
          )}
          <button type="button" onClick={() => { setRaw(null); onTune(null); }} className="text-xs text-ink-3 underline">
            Remove tune
          </button>
        </div>
      )}
    </div>
  );
}
