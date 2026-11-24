import { describe, expect, it } from "vitest";
import { assemble, sectionStarts, validateBlueprint, validateSection, type Blueprint, type SectionPart } from "./sections";
import { DEMO_SONG } from "@/lib/ir/demo";
import { EVAL_TUNES } from "@/eval/tunes";
import type { Direction } from "./plan";

const bp: Blueprint = {
  title: "T", summary: "", key: "C major", tempo: 90, timeSignature: { numerator: 4, denominator: 4 }, difficulty: "intermediate",
  tuning: "standard", capo: 0, transpose: 0, groove: "", hook: "", tasteNotes: [],
  sections: [{ name: "A", bars: 2, role: "statement", plan: "", chords: "C | G" }, { name: "B", bars: 2, role: "climax", plan: "", chords: "F | C" }],
};
const direction: Direction = { name: "x", style: "Folk", flair: "clean", difficulty: "intermediate", reharm: "none", fidelity: "exact", concept: "", devices: [] };
const bar = { ...DEMO_SONG.sections[0].bars[0], beats: [] as typeof DEMO_SONG.sections[0]["bars"][0]["beats"] };

describe("sectioned writing", () => {
  it("checks the blueprint's total length", () => {
    expect(validateBlueprint(bp, { minBars: 4, maxBars: 8 })).toEqual([]);
    expect(validateBlueprint(bp, { exactBars: 6, minBars: 6, maxBars: 6 }).length).toBe(1);
  });
  it("computes section start bars and stitches sections into one song", () => {
    expect(sectionStarts(bp)).toEqual([0, 2]);
    const part: SectionPart = { bars: [bar, bar], note: "n" };
    const song = assemble(bp, [part, part], "Folk");
    expect(song.sections.map((s) => [s.name, s.bars.length])).toEqual([["A", 2], ["B", 2]]);
    expect(song.texture).toBe("fingerstyle");
  });
  it("flags a section with the wrong bar count and missing tab", () => {
    const errs = validateSection({ bars: [bar], note: "" }, { bp, index: 0, startBar: 0, fidelity: "exact", style: "Folk" });
    expect(errs.some((e) => /exactly 2 bars/.test(e.message))).toBe(true);
    expect(errs.some((e) => /no tab beats/.test(e.message))).toBe(true);
  });
  it("checks only the section's slice of an imported tune", () => {
    const tune = EVAL_TUNES[0].tune;
    const errs = validateSection({ bars: [bar, bar], note: "" }, { bp, index: 1, startBar: 2, tune, fidelity: "exact", style: "Folk" });
    expect(errs.some((e) => /tune bar 1\)/.test(e.where))).toBe(true); // slice-relative numbering
    void direction;
  });
});
