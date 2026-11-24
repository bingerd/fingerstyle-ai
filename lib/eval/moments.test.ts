import { describe, expect, it } from "vitest";
import { detectMoments } from "./moments";
import { DEMO_SONG } from "@/lib/ir/demo";
import type { Song, TabBeat, TabNote } from "@/lib/ir/schema";

const n = (string: number, fret: number, technique: TabNote["technique"] = "none"): TabNote => ({ string, fret, technique });
const b = (notes: TabNote[], value: TabBeat["value"] = 8, extra: Partial<TabBeat> = {}): TabBeat => ({ value, dotted: false, triplet: false, percussion: "none", notes, chord: "", ...extra });
const chords = DEMO_SONG.sections[0].bars[0].chords.slice(0, 1).map((c) => ({ ...c, rhythm: [{ value: 1 as const, dotted: false, play: "all" as const }] }));
const songOf = (bars: TabBeat[][], tempo = 90): Song => ({ ...DEMO_SONG, tempo, texture: "fingerstyle", sections: [{ name: "A", note: "", bars: bars.map((beats) => ({ chords, beats })) }] });

const plain = [b([n(5, 3), n(2, 1)], 2), b([n(4, 2)], 2)];
const groove = [b([n(2, 1)], 4), b([], 4, { percussion: "slap" }), b([n(2, 3)], 4), b([], 4, { percussion: "slap" })];
const chime = [b([n(1, 12, "harmonic"), n(2, 12, "harmonic")], 2), b([n(3, 7, "harmonic")], 2)];
const run = Array.from({ length: 8 }, (_, i) => b([n(1, i % 2 ? 5 : 3)], 16)).concat([b([n(1, 0)], 2)]);

describe("moments", () => {
  it("finds the slap groove, the harmonic chime and the fast run with their bars", () => {
    const m = detectMoments(songOf([plain, groove, groove, chime, run]));
    const by = Object.fromEntries(m.map((x) => [x.kind, x]));
    expect(by["slap-groove"]).toMatchObject({ startBar: 1, endBar: 2 });
    expect(by.harmonics).toMatchObject({ startBar: 3, endBar: 3 });
    expect(by["fast-run"]).toMatchObject({ startBar: 4 });
    expect(by.finale).toBeUndefined();
  });
  it("calls out a harmonic ending as the finale", () => {
    expect(detectMoments(songOf([plain, chime])).some((x) => x.kind === "finale")).toBe(true);
  });
  it("is quiet for plain playing and for comping", () => {
    expect(detectMoments(songOf([plain, plain]))).toEqual([]);
    expect(detectMoments(DEMO_SONG)).toEqual([]);
  });
});
