import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { rawFromMidi } from "./importers";
import { guitarFromMidi, tuningFromText } from "./toGuitar";
import { barBeats, errorsOnly, guitarOf, notePitch, validateBeats } from "@/lib/theory/validate";
import { attacks } from "@/lib/eval/metrics";

function check(path: string) {
  const raw = rawFromMidi(new Uint8Array(readFileSync(path)), "x");
  const song = guitarFromMidi(raw, { title: "x" });
  const per = barBeats(song.timeSignature);
  const errors = song.sections.flatMap((s) => s.bars.flatMap((b, i) => errorsOnly(validateBeats(b.beats, per, [], `${s.name} ${i + 1}`))));
  return { raw, song, errors };
}

describe("MIDI → guitar tab", () => {
  it("fills every bar exactly and stays playable (Ode to Joy)", () => {
    const { song, errors } = check("examples/ode-to-joy.mid");
    expect(errors).toEqual([]);
    expect(song.sections.flatMap((s) => s.bars).length).toBeGreaterThan(4);
  });
  it("keeps every MIDI pitch (octave-folded into range)", () => {
    const { raw, song } = check("examples/ode-to-joy.mid");
    const g = guitarOf(song);
    const tab = new Set(song.sections.flatMap((s) => s.bars.flatMap((b) => b.beats.flatMap((bt) => bt.notes.map((n) => notePitch(n, g))))));
    const midi = new Set(raw.tracks.flatMap((t) => t.notes.map((n) => n.midi)));
    for (const m of midi) expect(tab.has(m) || tab.has(m + 12) || tab.has(m - 12)).toBe(true);
    expect(attacks(song).length).toBeGreaterThan(0);
  });
  it("reads ClassTab tuning lines", () => {
    expect(tuningFromText("D A D G B E")).toBe("drop-d");
    expect(tuningFromText("Standard (EADGBE)")).toBe("standard");
    expect(tuningFromText("DADGAD")).toBe("dadgad");
  });
  const lagrima = "data/classtab/extracted/classtab/tarrega_lagrima.mid";
  it.skipIf(!existsSync(lagrima))("renders a real ClassTab piece without timing errors", () => {
    const { errors, song } = check(lagrima);
    expect(errors).toEqual([]);
    const spans = song.sections.flatMap((s) => s.bars.flatMap((b) => b.beats.map((bt) => {
      const f = bt.notes.filter((n) => n.fret > 0).map((n) => n.fret);
      return f.length ? Math.max(...f) - Math.min(...f) : 0;
    })));
    expect(Math.max(...spans)).toBeLessThanOrEqual(5);
  });
});
