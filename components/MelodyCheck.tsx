"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { rawFromTune, type Tune } from "@/lib/tune/tune";
import { guitarFromMidi } from "@/lib/tune/toGuitar";
import { ScoreView, type LoopRange } from "./ScoreView";
import { Spinner } from "./Composer";

type Recall = { tune: Tune; confidence: "high" | "medium" | "low"; doubts: string };

/**
 * "Is this the tune?" The model writes down the melody it remembers; the player listens and
 * confirms (or nudges it) before anything is arranged. A confirmed melody is then enforced
 * note by note, exactly like an imported file.
 */
export function MelodyCheck({ request, provider, onConfirm, onCancel }: { request: string; provider: string; onConfirm: (t: Tune) => void; onCancel: () => void }) {
  const [result, setResult] = useState<Recall | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [loop, setLoop] = useState<LoopRange>(null);
  const started = useRef(false);

  async function recall(withHint?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/melody", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, provider, hint: withHint || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't recall the melody");
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    Promise.resolve().then(() => recall());
  });

  const preview = useMemo(
    () => (result ? guitarFromMidi(rawFromTune(result.tune), { title: `${result.tune.title}: melody check` }) : null),
    [result],
  );

  return (
    <div className="space-y-3 rounded-xl border border-accent/40 bg-accent-soft/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Is this the tune?</p>
        <button type="button" onClick={onCancel} className="focus-ring rounded px-2 text-xs text-ink-3 hover:text-ink">Close</button>
      </div>
      {loading && <p className="flex items-center gap-2 text-sm text-ink-2"><Spinner /> Recalling the melody, which takes about a minute…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && preview && !loading && (
        <>
          <p className="text-xs leading-relaxed text-ink-2">
            The model is <b>{result.confidence === "high" ? "confident" : result.confidence === "medium" ? "fairly sure" : "unsure"}</b> about this melody.
            {result.doubts ? ` Doubts: ${result.doubts}` : ""} Press play and listen.
          </p>
          <ScoreView song={preview} loop={loop} onLoopChange={setLoop} onActiveChord={() => {}} onChordClick={() => {}} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onConfirm(result.tune)} className="focus-ring h-9 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink">
              ✓ That&apos;s it: arrange this melody
            </button>
            <input
              value={hint} onChange={(e) => setHint(e.target.value)}
              placeholder="Not quite? e.g. “the chorus starts higher”, “bar 3 is wrong”"
              className="focus-ring min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm placeholder:text-ink-3"
            />
            <button type="button" onClick={() => recall(hint)} className="focus-ring h-9 rounded-xl border border-line px-3 text-sm hover:bg-surface-2">Try again</button>
          </div>
          <p className="text-[11px] text-ink-3">Still wrong? Import a MIDI or Guitar Pro file of the song for a guaranteed melody.</p>
        </>
      )}
    </div>
  );
}
