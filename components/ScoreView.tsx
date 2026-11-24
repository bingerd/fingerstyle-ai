"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as AlphaTabNS from "@coderline/alphatab";
import type { Song } from "@/lib/ir/schema";
import { songToAlphaTex, type GuitarSound, type StaffView } from "@/lib/alphatex/fromIR";

import { loadAlphaTab, pickSoundFont, recordedGuitars } from "@/lib/client/alphatab";
import { downloadGp, humanize } from "@/lib/client/humanize";
import { Fretboard } from "./Fretboard";

export type LoopRange = { startBar: number; endBar: number } | null;

export function ScoreView({
  song,
  loop,
  onLoopChange,
  onActiveChord,
  onChordClick,
  playRequest = 0,
  speedRequest,
}: {
  song: Song;
  loop: LoopRange;
  onLoopChange: (loop: LoopRange) => void;
  onActiveChord: (id: string | null) => void;
  onChordClick: (id: string) => void;
  /** Bump to start playback as soon as the (re)loaded score is ready, e.g. for reharm previews. */
  playRequest?: number;
  /** Ask the player to switch to a practice speed (bump n to re-apply the same value). */
  speedRequest?: { value: number; n: number };
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
  const [fingering, setFingering] = useState(true);
  const [fretboard, setFretboard] = useState(false);
  // Chord grids add a tall row above the tab; fingerstyle players read the tab itself, so hide them by default there.
  const [diagrams, setDiagrams] = useState(song.texture !== "fingerstyle");
  const diagramsRef = useRef(diagrams);
  const fretboardRef = useRef(false);
  const [activeBeat, setActiveBeat] = useState<{ bar: number; beat: number } | null>(null);
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

  const { tex, beatRefs } = useMemo(() => songToAlphaTex(song, view, sound, { fingering }), [song, view, sound, fingering]);
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
  /** The tex whose MIDI is currently loaded in the player. */
  const loadedTex = useRef<string | null>(null);
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
        if (prefs.fingering === false) setFingering(false);
        if (prefs.fretboard) { setFretboard(true); fretboardRef.current = true; }
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
        applyFingeringMode(api, texRef.current);
        api.settings.notation.elements.set(at.NotationElement.EffectDynamics, false);
        // The page already shows the title; keep the tab as high on screen as possible.
        for (const el of [at.NotationElement.ScoreTitle, at.NotationElement.ScoreSubTitle, at.NotationElement.ScoreArtist, at.NotationElement.ScoreAlbum, at.NotationElement.ScoreWords, at.NotationElement.ScoreMusic, at.NotationElement.ScoreWordsAndMusic, at.NotationElement.ScoreCopyright])
          api.settings.notation.elements.set(el, false);
        if (prefs.diagrams !== undefined && initialTexture.current === "fingerstyle") { diagramsRef.current = prefs.diagrams; setDiagrams(prefs.diagrams); }
        api.settings.notation.elements.set(at.NotationElement.ChordDiagrams, diagramsRef.current);
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
          loadedTex.current = texRef.current;
          applyLoop.current();
          if (pendingPlay.current) {
            pendingPlay.current = false;
            api.play();
          }
        });
        api.playerStateChanged.on((e) => setPlaying(e.state === at.synth.PlayerState.Playing));
        api.playedBeatChanged.on((beat) => {
          lookup.current.onActiveChord(toChord(beat));
          if (fretboardRef.current && beat.voice.bar.staff.track.index === 0) setActiveBeat({ bar: beat.voice.bar.index, beat: beat.index });
        });
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
    applyFingeringMode(api, tex);
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
  function toggleDiagrams() {
    const next = !diagrams;
    setDiagrams(next);
    diagramsRef.current = next;
    if (song.texture === "fingerstyle") writePrefs({ diagrams: next });
    const api = apiRef.current, at = atRef.current;
    if (!api || !at) return;
    api.settings.notation.elements.set(at.NotationElement.ChordDiagrams, next);
    api.updateSettings();
    api.render();
  }
  function setRow(n: number) { setBarsPerRow(n); writePrefs({ barsPerRow: n }); }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else sectionRef.current?.requestFullscreen().catch(() => {});
  }

  useEffect(() => { if (apiRef.current) apiRef.current.playbackSpeed = speed; }, [speed]);
  const lastSpeedRequest = useRef(0);
  useEffect(() => {
    if (!speedRequest || speedRequest.n === lastSpeedRequest.current) return;
    lastSpeedRequest.current = speedRequest.n;
    Promise.resolve().then(() => setSpeed(speedRequest.value));
  }, [speedRequest]);
  useEffect(() => { if (apiRef.current) apiRef.current.metronomeVolume = metronome ? 1 : 0; }, [metronome]);
  useEffect(() => { if (apiRef.current) apiRef.current.countInVolume = countIn ? 1 : 0; }, [countIn]);

  useEffect(() => {
    loopRef.current = loop;
    applyLoop.current();
  }, [loop, tex, rendering]);

  useEffect(() => {
    if (!playRequest) return;
    const api = apiRef.current;
    // Same score already loaded (e.g. a new loop range): start right away; otherwise wait for the reload.
    if (api && loadedTex.current === texRef.current) {
      applyLoop.current();
      api.play();
    } else pendingPlay.current = true;
  }, [playRequest]);

  const totalBars = song.sections.reduce((n, s) => n + s.bars.length, 0);

  return (
    <section ref={sectionRef} className={`card overflow-hidden ${fullscreen ? "flex h-screen flex-col rounded-none" : ""}`}>
      {/* One slim transport bar; everything else lives in Options so the tab gets the screen. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <button
          onClick={() => apiRef.current?.playPause()}
          disabled={!ready}
          className="focus-ring inline-flex h-9 min-w-22 items-center justify-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-40"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <PauseIcon /> : <PlayIcon />} {ready ? (playing ? "Pause" : "Play") : "Loading…"}
        </button>
        <button onClick={() => apiRef.current?.stop()} disabled={!ready} className="focus-ring h-9 rounded-full border border-line px-3 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-40">
          Stop
        </button>
        <label className="flex items-center gap-2 text-sm text-ink-2" title="Practice tempo">
          <input
            type="range" min={0.4} max={1.25} step={0.05} value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="w-24 accent-[var(--accent)]" aria-label="Tempo"
          />
          <span className="w-14 font-mono text-xs tabular-nums text-ink">{Math.round(song.tempo * speed)} bpm</span>
        </label>
        <Toggle on={!!loop} onClick={() => onLoopChange(loop ? null : { startBar: 0, endBar: totalBars - 1 })}>Loop</Toggle>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-line p-0.5 text-sm" role="tablist" aria-label="Notation view">
            {(["tabs", "both", "score"] as const).map((v) => (
              <button
                key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={`focus-ring rounded-full px-3 py-1 transition ${view === v ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}
              >
                {v === "both" ? "Tab + staff" : v === "tabs" ? "Tab" : "Staff"}
              </button>
            ))}
          </div>
          <span className="flex items-center rounded-full border border-line text-sm" aria-label="Size">
            <button onClick={() => zoom(-0.15)} className="focus-ring h-8 w-8 rounded-full hover:bg-surface-2" aria-label="Smaller">−</button>
            <span className="w-10 text-center font-mono text-xs tabular-nums">{Math.round(scale * 100)}%</span>
            <button onClick={() => zoom(0.15)} className="focus-ring h-8 w-8 rounded-full hover:bg-surface-2" aria-label="Larger">+</button>
          </span>
          <details className="relative">
            <summary className="focus-ring flex h-8 cursor-pointer list-none items-center gap-1 rounded-full border border-line px-3 text-sm text-ink-2 hover:bg-surface-2">⚙ Options</summary>
            <div className="absolute right-0 z-30 mt-1 w-72 space-y-3 rounded-xl border border-line bg-surface p-3 text-sm shadow-lg">
              <div className="flex flex-wrap gap-1.5">
                <Toggle on={metronome} onClick={() => setMetronome((v) => !v)}>Metronome</Toggle>
                <Toggle on={countIn} onClick={() => setCountIn((v) => !v)}>Count-in</Toggle>
                <Toggle on={fingering} onClick={() => { setFingering((f) => { writePrefs({ fingering: !f }); return !f; }); }}>Fingerings</Toggle>
                {song.texture === "fingerstyle" && (
                  <Toggle on={fretboard} onClick={() => { const v = !fretboard; setFretboard(v); fretboardRef.current = v; writePrefs({ fretboard: v }); }}>Fretboard</Toggle>
                )}
                <Toggle on={diagrams} onClick={toggleDiagrams}>Chord diagrams</Toggle>
                <Toggle on={expressive} onClick={toggleExpressive}>Expressive playback</Toggle>
              </div>
              <label className="flex items-center justify-between gap-2 text-ink-2">
                Sound
                <select value={sound} onChange={(e) => setSound(e.target.value as GuitarSound)} className="focus-ring h-8 rounded-full border border-line bg-surface px-2 text-sm text-ink">
                  {recorded.nylon && <option value="nylon-rec">Nylon, recorded</option>}
                  {recorded.steel && <option value="steel-rec">Steel, recorded</option>}
                  <option value="nylon">Nylon acoustic</option>
                  <option value="steel">Steel acoustic</option>
                  <option value="jazz">Jazz electric</option>
                  <option value="clean">Clean electric</option>
                </select>
              </label>
              <div className="flex items-center justify-between gap-2 text-ink-2">
                Bars per line
                <span className="flex rounded-full border border-line p-0.5">
                  {[-1, 2, 3, 4].map((n) => (
                    <button key={n} onClick={() => setRow(n)} aria-pressed={barsPerRow === n} className={`focus-ring rounded-full px-2.5 py-0.5 text-xs ${barsPerRow === n ? "bg-ink text-bg" : "hover:text-ink"}`}>
                      {n === -1 ? "Auto" : n}
                    </button>
                  ))}
                </span>
              </div>
              {fingering && view === "tabs" && <p className="text-xs text-ink-3">In Tab view, fingerings show above single notes. Use Tab + staff to see chord fingerings.</p>}
              <div className="border-t border-line pt-2">
                <p className="mb-1 text-xs font-medium tracking-widest text-ink-3 uppercase">Export</p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => atRef.current && apiRef.current && downloadGp(atRef.current, apiRef.current, song.title)} className="focus-ring rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-2">Guitar Pro</button>
                  <button onClick={() => apiRef.current?.downloadMidi()} className="focus-ring rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-2">MIDI</button>
                  <button onClick={() => apiRef.current?.print()} className="focus-ring rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-2">Print / PDF</button>
                </div>
              </div>
            </div>
          </details>
          <button onClick={toggleFullscreen} title={fullscreen ? "Exit practice view" : "Practice view (full screen)"} className="focus-ring h-8 rounded-full border border-line px-3 text-sm text-ink-2 hover:bg-surface-2">
            {fullscreen ? "Exit" : "⛶"}
          </button>
        </div>
      </div>

      {loop && (
        <div className="flex items-center justify-between bg-accent-soft px-4 py-1.5 text-sm text-ink">
          <span>{loop.startBar === loop.endBar ? `Looping bar ${loop.startBar + 1}` : `Looping bars ${loop.startBar + 1}–${loop.endBar + 1}`}</span>
          <button onClick={() => onLoopChange(null)} className="focus-ring rounded px-2 font-medium text-accent hover:underline">Clear loop</button>
        </div>
      )}

      <div ref={scrollRef} className={`relative overflow-y-auto bg-paper ${fullscreen ? "min-h-0 flex-1" : "h-[calc(100vh-11rem)] min-h-[420px]"}`}>
        {error && <p className="p-6 text-sm text-red-700">Score error: {error}</p>}
        {rendering && !error && <div className="absolute inset-x-6 top-6 h-40 rounded-xl skeleton opacity-60" aria-hidden />}
        {/* alphaTab renders sheet music in black on this paper surface in both themes. */}
        <div ref={hostRef} className="text-black" />
      </div>
      {fretboard && song.texture === "fingerstyle" && <Fretboard song={song} active={activeBeat} />}
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

type ReadingPrefs = { view?: StaffView; scale?: number; barsPerRow?: number; expressive?: boolean; sound?: GuitarSound; fingering?: boolean; fretboard?: boolean; diagrams?: boolean };
const PREFS_KEY = "woodshed.reading";
function readPrefs(): ReadingPrefs {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as ReadingPrefs; } catch { return {}; }
}
function writePrefs(p: ReadingPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...p })); } catch {}
}

/**
 * Tab-only view: alphaTab can show fingerings above the tab for single notes (runs, melody);
 * chord fingerings only render on the standard staff, so "Tab + staff" uses the staff.
 */
function applyFingeringMode(api: AlphaTabNS.AlphaTabApi, tex: string) {
  const at = window.alphaTab;
  if (!at) return;
  api.settings.notation.fingeringMode = tex.includes("\\staff {tabs}") ? at.FingeringMode.SingleNoteEffectBand : at.FingeringMode.ScoreDefault;
  api.updateSettings();
}
