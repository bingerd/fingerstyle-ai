"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as AlphaTabNS from "@coderline/alphatab";
import type { Song } from "@/lib/ir/schema";
import { songToAlphaTex, type GuitarSound, type StaffView } from "@/lib/alphatex/fromIR";

import { loadAlphaTab, pickSoundFont, recordedGuitars } from "@/lib/client/alphatab";
import { downloadGp, humanize } from "@/lib/client/humanize";

export type LoopRange = { startBar: number; endBar: number } | null;

export function ScoreView({
  song,
  loop,
  onLoopChange,
  onActiveChord,
  onChordClick,
  playRequest = 0,
}: {
  song: Song;
  loop: LoopRange;
  onLoopChange: (loop: LoopRange) => void;
  onActiveChord: (id: string | null) => void;
  onChordClick: (id: string) => void;
  /** Bump to start playback as soon as the (re)loaded score is ready, e.g. for reharm previews. */
  playRequest?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<AlphaTabNS.AlphaTabApi | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // Reading preferences (remembered per browser): tab-only with rhythm stems reads fastest while playing.
  const [view, setViewState] = useState<StaffView>("tabs");
  const [scale, setScale] = useState(1.25);
  const [barsPerRow, setBarsPerRow] = useState(-1);
  const [fullscreen, setFullscreen] = useState(false);
  const [expressive, setExpressive] = useState(true);
  const expressiveRef = useRef(true);
  const atRef = useRef<typeof AlphaTabNS | null>(null);
  const [sound, setSoundState] = useState<GuitarSound>(song.texture === "fingerstyle" ? "nylon" : "steel");
  const [recorded, setRecorded] = useState({ nylon: false, steel: false });
  const initialTexture = useRef(song.texture);
  function setSound(s: GuitarSound) { setSoundState(s); writePrefs({ sound: s }); }
  const [ready, setReady] = useState(false);
  const [rendering, setRendering] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [metronome, setMetronome] = useState(false);
  const [countIn, setCountIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { tex, beatRefs } = useMemo(() => songToAlphaTex(song, view, sound), [song, view, sound]);
  // Index of the first beatRef of each bar → maps an alphaTab beat back to a chord id.
  const barOffsets = useMemo(() => {
    const offsets: number[] = [];
    beatRefs.forEach((r, i) => { if (offsets[r.barIndex] === undefined) offsets[r.barIndex] = i; });
    return offsets;
  }, [beatRefs]);
  const texRef = useRef(tex);
  const lookup = useRef({ beatRefs, barOffsets, onActiveChord, onChordClick });
  useEffect(() => {
    lookup.current = { beatRefs, barOffsets, onActiveChord, onChordClick };
  });

  // Loop a bar range (used by the loop toggle and by reharm previews).
  const loopRef = useRef(loop);
  const pendingPlay = useRef(false);
  const applyLoop = useRef(() => {});
  useEffect(() => {
    applyLoop.current = () => {
      const api = apiRef.current;
      const score = api?.score;
      const range = loopRef.current;
      if (!api || !score) return;
      if (!range) {
        api.playbackRange = null;
        api.isLooping = false;
        return;
      }
      const bars = score.masterBars;
      const start = bars[Math.max(0, range.startBar)];
      const end = bars[Math.min(bars.length - 1, range.endBar)];
      if (!start || !end) return;
      api.playbackRange = { startTick: start.start, endTick: end.start + end.calculateDuration() } as AlphaTabNS.synth.PlaybackRange;
      api.isLooping = true;
      api.tickPosition = start.start;
    };
  }, []);

  // Create the API once.
  useEffect(() => {
    let disposed = false;
    Promise.all([loadAlphaTab(), pickSoundFont(), recordedGuitars()])
      .then(([at, soundFontUrl, rec]) => {
        if (disposed || !hostRef.current) return;
        const prefs = readPrefs();
        if (prefs.view) setViewState(prefs.view);
        if (prefs.scale) setScale(prefs.scale);
        if (prefs.barsPerRow) setBarsPerRow(prefs.barsPerRow);
        setRecorded(rec);
        const available = (s?: GuitarSound) => s && (s === "nylon-rec" ? rec.nylon : s === "steel-rec" ? rec.steel : true);
        if (available(prefs.sound)) setSoundState(prefs.sound!);
        else if (rec.nylon && initialTexture.current === "fingerstyle") setSoundState("nylon-rec");
        if (prefs.expressive === false) { setExpressive(false); expressiveRef.current = false; }
        atRef.current = at;
        const api = new at.AlphaTabApi(hostRef.current, {
          core: { fontDirectory: "/alphatab/font/", engine: "svg" },
          display: { scale: prefs.scale ?? 1.25, barsPerRow: prefs.barsPerRow ?? -1, layoutMode: at.LayoutMode.Page, padding: [24, 32, 24, 32] },
          notation: { rhythmMode: at.TabRhythmMode.ShowWithBars },
          player: {
            playerMode: at.PlayerMode.EnabledSynthesizer,
            soundFont: soundFontUrl,
            scrollElement: scrollRef.current ?? undefined,
            scrollOffsetY: -40,
          },
        } as AlphaTabNS.json.SettingsJson);
        apiRef.current = api;
        api.settings.notation.elements.set(at.NotationElement.EffectDynamics, false);
        api.updateSettings();
        api.scoreLoaded.on((score) => { if (expressiveRef.current) humanize(at, score); });
        const toChord = (beat: AlphaTabNS.model.Beat) => {
          const { beatRefs, barOffsets } = lookup.current;
          const ref = beatRefs[(barOffsets[beat.voice.bar.index] ?? 0) + beat.index];
          return ref?.chordId ?? null;
        };
        api.renderStarted.on(() => setRendering(true));
        api.renderFinished.on(() => setRendering(false));
        api.playerReady.on(() => setReady(true));
        // Layer the recorded guitars on top once the main soundfont is in (later presets win).
        let layered = false;
        api.soundFontLoaded.on(() => {
          if (layered) return;
          layered = true;
          if (rec.nylon) api.loadSoundFont("/alphatab/freepats-nylon.sf2", true);
          if (rec.steel) api.loadSoundFont("/alphatab/freepats-steel.sf2", true);
        });
        api.midiLoaded.on(() => {
          applyLoop.current();
          if (pendingPlay.current) {
            pendingPlay.current = false;
            api.play();
          }
        });
        api.playerStateChanged.on((e) => setPlaying(e.state === at.synth.PlayerState.Playing));
        api.playedBeatChanged.on((beat) => lookup.current.onActiveChord(toChord(beat)));
        api.beatMouseDown.on((beat) => {
          const id = toChord(beat);
          if (id) lookup.current.onChordClick(id);
        });
        api.error.on((e) => setError(e.message));
        api.tex(texRef.current, [0]);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      disposed = true;
      apiRef.current?.destroy();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    texRef.current = tex;
    const api = apiRef.current;
    if (!api) return;
    api.stop();
    api.tex(tex, [0]);
  }, [tex]);

  // Zoom and bars-per-row need a re-layout, not a reload.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || (api.settings.display.scale === scale && api.settings.display.barsPerRow === barsPerRow)) return;
    api.settings.display.scale = scale;
    api.settings.display.barsPerRow = barsPerRow;
    api.updateSettings();
    api.render();
  }, [scale, barsPerRow]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === sectionRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function setView(v: StaffView) { setViewState(v); writePrefs({ view: v }); }
  function zoom(delta: number) {
    const next = Math.round(Math.min(2, Math.max(0.8, scale + delta)) * 100) / 100;
    setScale(next);
    writePrefs({ scale: next });
  }
  function toggleExpressive() {
    const next = !expressive;
    setExpressive(next);
    expressiveRef.current = next;
    writePrefs({ expressive: next });
    apiRef.current?.tex(texRef.current, [0]); // reload so the change applies to sound
  }
  function setRow(n: number) { setBarsPerRow(n); writePrefs({ barsPerRow: n }); }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else sectionRef.current?.requestFullscreen().catch(() => {});
  }

  useEffect(() => { if (apiRef.current) apiRef.current.playbackSpeed = speed; }, [speed]);
  useEffect(() => { if (apiRef.current) apiRef.current.metronomeVolume = metronome ? 1 : 0; }, [metronome]);
  useEffect(() => { if (apiRef.current) apiRef.current.countInVolume = countIn ? 1 : 0; }, [countIn]);

  useEffect(() => {
    loopRef.current = loop;
    applyLoop.current();
  }, [loop, tex, rendering]);

  useEffect(() => {
    if (playRequest) pendingPlay.current = true;
  }, [playRequest]);

  const totalBars = song.sections.reduce((n, s) => n + s.bars.length, 0);

  return (
    <section ref={sectionRef} className={`card overflow-hidden ${fullscreen ? "flex h-screen flex-col rounded-none" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <button
          onClick={() => apiRef.current?.playPause()}
          disabled={!ready}
          className="focus-ring inline-flex h-10 min-w-24 items-center justify-center gap-2 rounded-full bg-accent px-4 font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-40"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <PauseIcon /> : <PlayIcon />} {ready ? (playing ? "Pause" : "Play") : "Loading…"}
        </button>
        <button
          onClick={() => apiRef.current?.stop()}
          disabled={!ready}
          className="focus-ring h-10 rounded-full border border-line px-3 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-40"
        >
          Stop
        </button>

        <label className="ml-2 flex items-center gap-2 text-sm text-ink-2">
          Tempo
          <input
            type="range" min={0.4} max={1.25} step={0.05} value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="w-28 accent-[var(--accent)]"
          />
          <span className="w-16 font-mono text-xs tabular-nums text-ink">{Math.round(song.tempo * speed)} bpm</span>
        </label>

        <Toggle on={metronome} onClick={() => setMetronome((v) => !v)}>Metronome</Toggle>
        <Toggle on={countIn} onClick={() => setCountIn((v) => !v)}>Count-in</Toggle>
        <Toggle on={!!loop} onClick={() => onLoopChange(loop ? null : { startBar: 0, endBar: totalBars - 1 })}>Loop</Toggle>

        <label className="flex items-center gap-2 text-sm text-ink-2">
          Sound
          <select
            value={sound}
            onChange={(e) => setSound(e.target.value as GuitarSound)}
            className="focus-ring h-9 rounded-full border border-line bg-surface px-3 text-sm text-ink"
          >
            {recorded.nylon && <option value="nylon-rec">Nylon, recorded (FreePats)</option>}
            {recorded.steel && <option value="steel-rec">Steel, recorded (FreePats)</option>}
            <option value="nylon">Nylon acoustic</option>
            <option value="steel">Steel acoustic</option>
            <option value="jazz">Jazz electric</option>
            <option value="clean">Clean electric</option>
          </select>
        </label>

        <div className="ml-auto flex rounded-full border border-line p-0.5 text-sm" role="tablist" aria-label="Notation view">
          {(["both", "tabs", "score"] as const).map((v) => (
            <button
              key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`focus-ring rounded-full px-3 py-1.5 capitalize transition ${view === v ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}
            >
              {v === "both" ? "Tab + staff" : v === "tabs" ? "Tab" : "Staff"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2 text-sm text-ink-2">
        <span className="flex items-center gap-1" aria-label="Zoom">
          Size
          <button onClick={() => zoom(-0.15)} className="focus-ring h-8 w-8 rounded-full border border-line hover:bg-surface-2" aria-label="Smaller">−</button>
          <span className="w-11 text-center font-mono text-xs tabular-nums text-ink">{Math.round(scale * 100)}%</span>
          <button onClick={() => zoom(0.15)} className="focus-ring h-8 w-8 rounded-full border border-line hover:bg-surface-2" aria-label="Larger">+</button>
        </span>
        <span className="flex items-center gap-1">
          Bars per line
          <span className="flex rounded-full border border-line p-0.5">
            {[-1, 2, 3, 4].map((n) => (
              <button
                key={n} onClick={() => setRow(n)} aria-pressed={barsPerRow === n}
                className={`focus-ring rounded-full px-2.5 py-1 text-xs ${barsPerRow === n ? "bg-ink text-bg" : "hover:text-ink"}`}
              >
                {n === -1 ? "Auto" : n}
              </button>
            ))}
          </span>
        </span>
        <button
          onClick={toggleExpressive} aria-pressed={expressive}
          title="Melody louder than bass, soft inner voices, rolled big chords"
          className={`focus-ring h-8 rounded-full border px-3 ${expressive ? "border-accent bg-accent-soft text-ink" : "border-line hover:bg-surface-2"}`}
        >
          Expressive playback
        </button>
        <details className="relative">
          <summary className="focus-ring flex h-8 cursor-pointer list-none items-center rounded-full border border-line px-3 hover:bg-surface-2">Export ▾</summary>
          <div className="absolute z-10 mt-1 flex w-56 flex-col rounded-xl border border-line bg-surface p-1 text-sm shadow-lg">
            <button onClick={() => atRef.current && apiRef.current && downloadGp(atRef.current, apiRef.current, song.title)} className="rounded-lg px-3 py-2 text-left hover:bg-surface-2">
              Guitar Pro file (.gp)<span className="block text-xs text-ink-3">Guitar Pro 8, MuseScore, TuxGuitar</span>
            </button>
            <button onClick={() => apiRef.current?.downloadMidi()} className="rounded-lg px-3 py-2 text-left hover:bg-surface-2">
              MIDI file (.mid)<span className="block text-xs text-ink-3">Any DAW or sampler</span>
            </button>
            <button onClick={() => apiRef.current?.print()} className="rounded-lg px-3 py-2 text-left hover:bg-surface-2">
              Print / PDF<span className="block text-xs text-ink-3">Opens a print view</span>
            </button>
          </div>
        </details>
        <button onClick={toggleFullscreen} className="focus-ring ml-auto h-8 rounded-full border border-line px-3 hover:bg-surface-2">
          {fullscreen ? "Exit practice view" : "⛶ Practice view"}
        </button>
      </div>

      {loop && (
        <div className="flex items-center justify-between bg-accent-soft px-4 py-2 text-sm text-ink">
          <span>Looping bars {loop.startBar + 1}–{loop.endBar + 1}</span>
          <button onClick={() => onLoopChange(null)} className="focus-ring rounded px-2 font-medium text-accent hover:underline">Clear loop</button>
        </div>
      )}

      <div ref={scrollRef} className={`relative overflow-y-auto bg-paper ${fullscreen ? "min-h-0 flex-1" : "max-h-[80vh]"}`}>
        {error && <p className="p-6 text-sm text-red-700">Score error: {error}</p>}
        {rendering && !error && <div className="absolute inset-x-6 top-6 h-40 rounded-xl skeleton opacity-60" aria-hidden />}
        {/* alphaTab renders sheet music in black on this paper surface in both themes. */}
        <div ref={hostRef} className="text-black" />
      </div>
    </section>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`focus-ring h-9 rounded-full border px-3 text-sm transition ${on ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2 hover:bg-surface-2"}`}
    >
      {children}
    </button>
  );
}

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M3 1.5v11l9-5.5z" fill="currentColor" /></svg>
);
const PauseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" fill="currentColor" /></svg>
);

type ReadingPrefs = { view?: StaffView; scale?: number; barsPerRow?: number; expressive?: boolean; sound?: GuitarSound };
const PREFS_KEY = "woodshed.reading";
function readPrefs(): ReadingPrefs {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as ReadingPrefs; } catch { return {}; }
}
function writePrefs(p: ReadingPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...p })); } catch {}
}
