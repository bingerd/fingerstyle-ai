"use client";

import { useState } from "react";
import type { Tune } from "@/lib/tune/tune";
import type { Controls } from "@/lib/arrange/plan";
import { TuneImport } from "./TuneImport";
import { MelodyCheck } from "./MelodyCheck";

export const STYLES = [
  "Percussive pop fingerstyle", "Fingerstyle jazz", "Neo-soul / lo-fi", "Travis picking", "Harp harmonics & campanella",
  "Bossa nova", "Chord-melody", "Jazz comping", "Blues", "Funk", "Gypsy jazz", "Fingerstyle folk",
];
const POSITIONS = ["No preference", "Open position", "Mid-neck (5th–9th)", "Drop-2 voicings", "Shell voicings", "Up the neck"];

const EXAMPLES = [
  "ii–V–I in Bb with a turnaround",
  "12-bar blues in A, Texas shuffle feel",
  "Autumn Leaves-style changes in G minor",
  "Sad, slow progression in E minor that resolves to major",
  "Dm7 | G7 | Cmaj7 | A7",
];
const DIRECTIONS = ["jazzy", "folk fingerstyle", "cinematic", "make it sound good on solo guitar", "intimate ballad", "upbeat & percussive"];

export type ComposerInput = Omit<Controls, "alternatives"> & { alternatives: number; tune?: Tune };

type Opt<T extends string> = { value: T; label: string; hint?: string };
const AUTO_OPT = { value: "auto", label: "Auto", hint: "AI decides" } as const;
const FLAIR_OPTS: Opt<Controls["flair"]>[] = [AUTO_OPT, { value: "clean", label: "Clean", hint: "Tasteful" }, { value: "expressive", label: "Expressive", hint: "Slides, harmonics" }, { value: "showstopper", label: "Showstopper", hint: "Slaps, runs" }];
const LEVEL_OPTS: Opt<Controls["difficulty"]>[] = [AUTO_OPT, { value: "beginner", label: "Beginner" }, { value: "intermediate", label: "Intermediate" }, { value: "advanced", label: "Advanced" }];
const REHARM_OPTS: Opt<Controls["reharm"]>[] = [AUTO_OPT, { value: "none", label: "None", hint: "Original chords" }, { value: "light", label: "Light", hint: "Colour tones" }, { value: "moderate", label: "Moderate", hint: "Some subs" }, { value: "bold", label: "Bold", hint: "Rethink it" }];
const LENGTH_OPTS: Opt<Controls["length"]>[] = [{ value: "auto", label: "Auto", hint: "Full unless short tune" }, { value: "short", label: "Sketch", hint: "8–16 bars, faster" }, { value: "full", label: "Full piece", hint: "32–48 bars, sections" }];
const FIDELITY_OPTS: Opt<Controls["fidelity"]>[] = [AUTO_OPT, { value: "exact", label: "Exact", hint: "Every note" }, { value: "embellished", label: "Embellished", hint: "Ornaments, ±½ beat" }, { value: "free", label: "Free", hint: "Theme & variation" }];

function Segmented<T extends string>({ legend, value, options, onChange }: { legend: string; value: T; options: Opt<T>[]; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium tracking-widest text-ink-3 uppercase">{legend}</legend>
      <div className="flex gap-0.5 rounded-xl border border-line p-0.5">
        {options.map((o) => (
          <button
            key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
            className={`focus-ring min-w-0 flex-1 rounded-lg px-1.5 py-1.5 text-center transition ${value === o.value ? "bg-surface-2 shadow-sm" : "text-ink-2 hover:text-ink"}`}
          >
            <span className={`block truncate text-sm ${value === o.value ? "font-semibold text-ink" : ""}`}>{o.label}</span>
            {o.hint && <span className="block truncate text-[11px] leading-tight text-ink-3">{o.hint}</span>}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function Composer({ busy, onSubmit, initialFile, provider = "claude" }: { busy: boolean; onSubmit: (input: ComposerInput) => void; initialFile?: File | null; provider?: string }) {
  const [request, setRequest] = useState("");
  const [direction, setDirection] = useState("");
  const [style, setStyle] = useState("auto");
  const [custom, setCustom] = useState("");
  const [flair, setFlair] = useState<Controls["flair"]>("auto");
  const [difficulty, setDifficulty] = useState<Controls["difficulty"]>("auto");
  const [reharm, setReharm] = useState<Controls["reharm"]>("auto");
  const [fidelity, setFidelity] = useState<Controls["fidelity"]>("auto");
  const [alternatives, setAlternatives] = useState(2);
  const [length, setLength] = useState<Controls["length"]>("auto");
  const [position, setPosition] = useState(POSITIONS[0]);
  const [texture, setTexture] = useState<Controls["texture"]>("fingerstyle");
  const [source, setSource] = useState<"describe" | "import">(initialFile ? "import" : "describe");
  const [tune, setTune] = useState<Tune | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmed, setConfirmed] = useState<Tune | null>(null);

  const finalStyle = custom.trim() || style;
  const fingerstyle = source === "import" || texture === "fingerstyle";
  const n = alternatives;

  return (
    <form
      className="card space-y-5 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        const useTune = source === "import" && tune ? tune : source === "describe" && confirmed ? confirmed : undefined;
        const text = [request.trim(), direction.trim() && `Direction: ${direction.trim()}`].filter(Boolean).join("\n");
        onSubmit({
          request: text, style: finalStyle, difficulty, position, texture: useTune ? "fingerstyle" : texture,
          flair, reharm, fidelity, alternatives, length, tune: useTune,
        });
      }}
    >
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">What do you want to play?</h2>
          <div className="flex rounded-full border border-line p-0.5 text-sm" role="tablist" aria-label="Source">
            {(["describe", "import"] as const).map((s) => (
              <button
                key={s} type="button" role="tab" aria-selected={source === s} onClick={() => setSource(s)}
                className={`focus-ring rounded-full px-3 py-1 transition ${source === s ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}
              >
                {s === "describe" ? "Describe" : "Import a tune"}
              </button>
            ))}
          </div>
        </div>
        {source === "describe" ? (
          <>
            <label htmlFor="req" className="sr-only">Describe what you want to play</label>
            <textarea
              id="req"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              rows={3}
              placeholder="Name a song or progression, paste chords, or describe a mood…"
              className="focus-ring w-full resize-none rounded-xl border border-line bg-surface-2 p-3 text-[15px] leading-relaxed placeholder:text-ink-3"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  type="button" key={ex} onClick={() => setRequest(ex)}
                  className="focus-ring rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-2 hover:text-ink"
                >
                  {ex}
                </button>
              ))}
            </div>
            {confirmed ? (
              <p className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
                <span>✓ Melody confirmed by ear ({confirmed.bars.length} bars). The arrangement will be checked against it note by note.</span>
                <button type="button" onClick={() => setConfirmed(null)} className="underline">Remove</button>
              </p>
            ) : checking ? (
              <div className="mt-2"><MelodyCheck request={request} provider={provider} onConfirm={(t) => { setConfirmed(t); setChecking(false); }} onCancel={() => setChecking(false)} /></div>
            ) : (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-relaxed text-ink-3">
                Naming a song? Its melody comes from the model&apos;s memory.
                <button type="button" disabled={!request.trim()} onClick={() => setChecking(true)} className="focus-ring rounded-full border border-accent px-2.5 py-1 font-medium text-accent disabled:opacity-40">
                  ♪ Check the melody first
                </button>
              </p>
            )}
          </>
        ) : (
          <>
            <TuneImport tune={tune} onTune={setTune} initialFile={initialFile} />
            <p className="mt-2 text-xs leading-relaxed text-ink-3">
              Imported tunes are arranged as fingerstyle tab, and every melody note is checked against the file.
            </p>
          </>
        )}
      </div>

      <div>
        <label htmlFor="dir" className="mb-1.5 block text-xs font-medium tracking-widest text-ink-3 uppercase">Direction <span className="normal-case tracking-normal">(optional)</span></label>
        <input
          id="dir"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          placeholder="Leave empty and the AI picks what suits the song"
          className="focus-ring w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm placeholder:text-ink-3"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {DIRECTIONS.map((d) => (
            <button
              type="button" key={d} onClick={() => setDirection(d)}
              className="focus-ring rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-2 hover:text-ink"
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-medium tracking-widest text-ink-3 uppercase">Texture</legend>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["fingerstyle", "Solo fingerstyle", "Melody, bass and harmony in one tab"],
            ["comping", "Comping", "Chord voicings and rhythm"],
          ] as const).map(([v, label, hint]) => {
            const locked = source === "import" && v === "comping";
            const on = (source === "import" ? "fingerstyle" : texture) === v;
            return (
              <button
                key={v} type="button" aria-pressed={on} disabled={locked} onClick={() => setTexture(v)}
                className={`focus-ring rounded-xl border p-3 text-left transition disabled:opacity-40 ${on ? "border-accent bg-accent-soft" : "border-line hover:border-ink-3"}`}
              >
                <span className="block font-semibold">{label}</span>
                <span className="block text-xs text-ink-2">{hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-xs font-medium tracking-widest text-ink-3 uppercase">Style</legend>
        <div className="flex flex-wrap gap-1.5">
          {["auto", ...STYLES].map((s) => (
            <button
              type="button" key={s} aria-pressed={!custom && style === s}
              onClick={() => { setStyle(s); setCustom(""); }}
              className={`focus-ring rounded-full border px-3 py-1.5 text-sm transition ${!custom && style === s ? "border-ink bg-ink text-bg" : "border-line text-ink-2 hover:border-ink-3 hover:text-ink"}`}
            >
              {s === "auto" ? "✦ Let the AI choose" : s}
            </button>
          ))}
        </div>
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="…or any style: “Wes Montgomery octaves”, “Joni Mitchell open tuning vibe”"
          className="focus-ring mt-2 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm placeholder:text-ink-3"
        />
      </fieldset>

      <details className="group rounded-xl border border-line">
        <summary className="focus-ring flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-sm">
          <span><b>Steer it</b> <span className="text-ink-3">(optional, Auto lets the AI decide)</span></span>
          <span className="text-ink-3 transition group-open:rotate-180" aria-hidden>⌄</span>
        </summary>
        <div className="space-y-4 border-t border-line p-3">
          {fingerstyle && <Segmented legend="Length" value={length} options={LENGTH_OPTS} onChange={setLength} />}
          {fingerstyle && <Segmented legend="Flair" value={flair} options={FLAIR_OPTS} onChange={setFlair} />}
          <Segmented legend="Level" value={difficulty} options={LEVEL_OPTS} onChange={setDifficulty} />
          <Segmented legend="Reharmonization" value={reharm} options={REHARM_OPTS} onChange={setReharm} />
          {fingerstyle && <Segmented legend="Melody" value={fidelity} options={FIDELITY_OPTS} onChange={setFidelity} />}
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium tracking-widest text-ink-3 uppercase">Fretboard</span>
            <select
              value={position} onChange={(e) => setPosition(e.target.value)}
              className="focus-ring w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm"
            >
              {POSITIONS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
        </div>
      </details>

      <Segmented
        legend="Alternatives to compare"
        value={String(n) as "1" | "2" | "3"}
        options={[{ value: "1", label: "1", hint: "Fastest" }, { value: "2", label: "2", hint: "Compare" }, { value: "3", label: "3", hint: "Widest choice" }]}
        onChange={(v) => setAlternatives(Number(v))}
      />

      <button
        disabled={busy || (source === "import" && !tune)}
        className="focus-ring flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-60"
      >
        {busy ? (
          <><Spinner /> {n > 1 ? `Planning and writing ${n} arrangements in parallel…` : "Arranging, which can take a few minutes…"}</>
        ) : n > 1 ? (
          `Write ${n} arrangements and rank them`
        ) : (
          `Arrange${finalStyle === "auto" ? "" : ` in ${finalStyle}`}`
        )}
      </button>
    </form>
  );
}

export const Spinner = () => (
  <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" fill="none" />
    <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
  </svg>
);
