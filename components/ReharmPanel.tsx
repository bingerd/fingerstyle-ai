"use client";

import { useState } from "react";
import type { ChordEvent, ReharmOption, Song } from "@/lib/ir/schema";
import { neighbours } from "@/lib/ir/edit";
import type { Tune } from "@/lib/tune/tune";
import { ChordDiagram } from "./ChordDiagram";

const COLOR_STYLE: Record<ReharmOption["color"], string> = {
  subtle: "bg-good/15 text-good",
  colorful: "bg-warn/15 text-warn",
  bold: "bg-accent-soft text-accent",
};

const QUICK_WISHES = ["Darker", "More tension", "Smoother voice leading", "Easier to play", "Chromatic movement"];

export function ReharmPanel({
  song,
  chord,
  provider,
  tune,
  fidelity = "exact",
  previewIndex,
  onPreview,
  onApply,
  onClose,
}: {
  song: Song;
  chord: ChordEvent;
  provider: string;
  tune: Tune | null;
  fidelity?: "exact" | "embellished" | "free";
  previewIndex: number | null;
  onPreview: (option: ReharmOption | null, index: number | null) => void;
  onApply: (option: ReharmOption) => void;
  onClose: () => void;
}) {
  const [wish, setWish] = useState("");
  const [options, setOptions] = useState<ReharmOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { prev, next } = neighbours(song, chord.id);

  async function suggest(instruction = wish) {
    setLoading(true);
    setError(null);
    onPreview(null, null);
    try {
      const res = await fetch("/api/reharm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ song, targetId: chord.id, instruction: instruction || undefined, provider, tune: tune ?? undefined, fidelity }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setOptions(data.options);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="card flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden" aria-label="Reharmonize chord">
      <header className="flex items-start justify-between gap-3 border-b border-line p-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-ink-3 uppercase">Reharmonize</p>
          <div className="mt-1 flex items-center gap-2 font-mono text-sm text-ink-3">
            {prev && <span>{prev.symbol} →</span>}
            <span className="font-display text-2xl font-semibold text-ink">{chord.symbol}</span>
            {next && <span>→ {next.symbol}</span>}
          </div>
          <p className="font-mono text-xs text-ink-3">{chord.roman}</p>
        </div>
        <div className="flex items-start gap-2">
          <ChordDiagram voicing={chord.voicing} size={1.15} />
          <button onClick={onClose} className="focus-ring rounded-full p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close reharm panel">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
      </header>

      <div className="space-y-3 border-b border-line p-4">
        <form onSubmit={(e) => { e.preventDefault(); suggest(); }} className="flex gap-2">
          <input
            value={wish}
            onChange={(e) => setWish(e.target.value)}
            placeholder="Optional: what are you after?"
            className="focus-ring min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm placeholder:text-ink-3"
          />
          <button disabled={loading} className="focus-ring rounded-xl bg-ink px-4 text-sm font-semibold text-bg disabled:opacity-50">
            {loading ? "Thinking…" : options ? "Again" : "Suggest"}
          </button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_WISHES.map((w) => (
            <button
              key={w} disabled={loading}
              onClick={() => { setWish(w); suggest(w); }}
              className="focus-ring rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
        {loading && Array.from({ length: 3 }, (_, i) => <div key={i} className="h-36 rounded-xl skeleton" />)}
        {!loading && !options && !error && (
          <p className="text-sm leading-relaxed text-ink-2">
            Get five substitutions for this chord, from subtle to bold. Each one is voice-led from <b>{prev?.symbol ?? "the start"}</b> into{" "}
            <b>{next?.symbol ?? "the end"}</b>. <b>Preview</b> plays it in context, and <b>Apply</b> keeps it (you can undo).
          </p>
        )}
        {!loading &&
          options?.map((opt, i) => (
            <article
              key={i}
              className={`rise rounded-xl border p-3 transition ${previewIndex === i ? "border-accent bg-accent-soft/40" : "border-line"}`}
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="font-semibold">{opt.technique}</h4>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${COLOR_STYLE[opt.color]}`}>{opt.color}</span>
              </div>
              <div className="mb-2 flex flex-wrap gap-3">
                {opt.chords.map((c, ci) => (
                  <div key={ci} className="flex flex-col items-center">
                    <span className="font-display text-lg font-semibold">{c.symbol}</span>
                    <span className="font-mono text-[10px] text-ink-3">{c.roman}</span>
                    <ChordDiagram voicing={c.voicing} size={1.1} />
                  </div>
                ))}
              </div>
              <p className="mb-3 text-sm leading-relaxed text-ink-2">{opt.why}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => (previewIndex === i ? onPreview(null, null) : onPreview(opt, i))}
                  className="focus-ring rounded-full border border-line px-3 py-1.5 text-sm hover:bg-surface-2"
                >
                  {previewIndex === i ? "Stop preview" : "Preview"}
                </button>
                <button onClick={() => onApply(opt)} className="focus-ring rounded-full bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:brightness-110">
                  Apply
                </button>
              </div>
            </article>
          ))}
      </div>
    </aside>
  );
}
