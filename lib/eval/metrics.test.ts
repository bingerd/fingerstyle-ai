import { describe, expect, it } from "vitest";
import { melodyScore, playability } from "./metrics";
import { EVAL_TUNES } from "@/eval/tunes";
import { DEMO_SONG } from "@/lib/ir/demo";
import type { Song, TabBeat } from "@/lib/ir/schema";
import type { Tune } from "@/lib/tune/tune";
import { STANDARD_TUNING } from "@/lib/theory/validate";

/** Build a single-string "arrangement" that plays a tune's melody exactly (shifted by k semitones). */
function songFromTune(tune: Tune, k = 0, introBars = 0): Song {
  const rest: TabBeat = { value: 1, dotted: false, triplet: false, percussion: "none", notes: [], chord: "" };
  const toBeats = (b: Tune["bars"][number]): TabBeat[] => {
    const beats: TabBeat[] = [];
    let pos = 0;
    for (const n of b.melody) {
      if (n.start > pos) throw new Error("test helper expects no rests");
      const midi = n.midi + k;
      const string = midi >= STANDARD_TUNING[5] ? 1 : midi >= STANDARD_TUNING[4] ? 2 : 3;
      const value = n.dur === 4 ? 1 : n.dur === 2 ? 2 : n.dur === 1 || n.dur === 1.5 ? 4 : 8;
      beats.push({ value, dotted: n.dur === 1.5, triplet: false, percussion: "none", notes: [{ string, fret: midi - STANDARD_TUNING[6 - string], technique: "none" }], chord: "" });
      pos += n.dur;
    }
    return beats;
  };
  const chords = DEMO_SONG.sections[0].bars[0].chords;
  return {
    ...DEMO_SONG,
    texture: "fingerstyle",
    sections: [{
      name: "A", note: "",
      bars: [
        ...Array.from({ length: introBars }, () => ({ chords, beats: [rest] })),
        ...tune.bars.map((b) => ({ chords, beats: toBeats(b) })),
      ],
    }],
  };
}

describe("melodyScore", () => {
  const ode = EVAL_TUNES[0].tune;
  it("scores an exact melody 100%", () => {
    expect(melodyScore(songFromTune(ode), ode).exact).toBe(1);
  });
  it("is transposition- and intro-invariant", () => {
    const s = melodyScore(songFromTune(ode, 5, 1), ode);
    expect(s).toMatchObject({ exact: 1, transpose: 5, barOffset: 1 });
  });
  it("gives a different tune a low score", () => {
    const twinkle = EVAL_TUNES[1].tune;
    expect(melodyScore(songFromTune(twinkle), ode).exact).toBeLessThan(0.5);
  });
});

describe("playability", () => {
  it("summarizes the demo song", () => {
    const p = playability(DEMO_SONG);
    expect(p.bars).toBe(8);
    expect(p.errors).toBe(0);
    expect(p.maxSpan).toBeLessThanOrEqual(4);
  });
});
