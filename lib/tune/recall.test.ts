import { describe, expect, it } from "vitest";
import { recallToTune, validateRecall, type MelodyRecall } from "./recall";
import { rawFromTune } from "./tune";
import { guitarFromMidi } from "./toGuitar";
import { melodyScore } from "@/lib/eval/metrics";
import { EVAL_TUNES } from "@/eval/tunes";

const ok: MelodyRecall = {
  title: "x", tempo: 100, timeSignature: { numerator: 4, denominator: 4 }, confidence: "high", doubts: "",
  bars: [{ melody: [{ start: 0, dur: 1, midi: 64 }, { start: 1, dur: 1, midi: 66 }] }, { melody: [{ start: 0, dur: 4, midi: 67 }] }],
};

describe("melody recall", () => {
  it("accepts a well-formed melody and marks it as from memory", () => {
    expect(validateRecall(ok)).toEqual([]);
    expect(recallToTune(ok).source).toBe("memory");
  });
  it("rejects overlaps, notes spilling over the bar and silly pitches", () => {
    const bad: MelodyRecall = { ...ok, bars: [{ melody: [{ start: 0, dur: 2, midi: 64 }, { start: 1, dur: 4, midi: 120 }] }, ok.bars[1]] };
    const msgs = validateRecall(bad).map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/overlap/);
    expect(msgs).toMatch(/inside the 4-beat bar/);
    expect(msgs).toMatch(/out of range/);
  });
  it("previews a tune as playable tab that keeps every melody note", () => {
    const tune = EVAL_TUNES[0].tune;
    const song = guitarFromMidi(rawFromTune(tune), { title: "t" });
    expect(melodyScore(song, tune).exact).toBe(1);
  });
});
