import { describe, expect, it } from "vitest";
import { barDifficulties, lessonPlan } from "./lesson";
import { DEMO_SONG } from "@/lib/ir/demo";
import type { Song, TabBeat, TabNote } from "@/lib/ir/schema";

const n = (string: number, fret: number, technique: TabNote["technique"] = "none"): TabNote => ({ string, fret, technique });
const b = (notes: TabNote[], value: TabBeat["value"]): TabBeat => ({ value, dotted: false, triplet: false, percussion: "none", notes, chord: "" });
const chords = DEMO_SONG.sections[0].bars[0].chords.slice(0, 1).map((c) => ({ ...c, rhythm: [{ value: 1 as const, dotted: false, play: "all" as const }] }));
const easy = [b([n(5, 3), n(2, 1)], 1)];
const hard = Array.from({ length: 16 }, (_, i) => b([n(1, i % 2 ? 12 : 7), n(4, i % 2 ? 9 : 5)], 16));
const song: Song = { ...DEMO_SONG, tempo: 120, texture: "fingerstyle", sections: [{ name: "A", note: "", bars: [easy, easy, hard, easy].map((beats) => ({ chords, beats })) }] };

describe("practice path", () => {
  it("rates the fast, stretched bar hardest", () => {
    const d = barDifficulties(song);
    expect(d[2].score).toBeGreaterThan(d[0].score + 0.3);
    expect(d[2].reasons.join(" ")).toMatch(/notes\/second/);
  });
  it("starts with the hard spot, slowly, and ends with the whole piece at full tempo", () => {
    const plan = lessonPlan(song);
    expect(plan[0]).toMatchObject({ startBar: 2, endBar: 3 });
    expect(plan[0].speed).toBeLessThanOrEqual(0.6);
    expect(plan.at(-1)).toMatchObject({ title: "Whole piece", speed: 1, startBar: 0, endBar: 3 });
  });
});
