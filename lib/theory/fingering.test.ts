import { describe, expect, it } from "vitest";
import { computeFingerings, fingeringKey } from "./fingering";
import { DEMO_SONG } from "@/lib/ir/demo";
import type { Song, TabBeat, TabNote } from "@/lib/ir/schema";
import { songToAlphaTex } from "@/lib/alphatex/fromIR";
import * as at from "@coderline/alphatab";

const n = (string: number, fret: number, technique: TabNote["technique"] = "none"): TabNote => ({ string, fret, technique });
const beat = (notes: TabNote[], value: TabBeat["value"] = 4): TabBeat => ({ value, dotted: false, triplet: false, percussion: "none", notes, chord: "" });
const songOf = (beats: TabBeat[]): Song => ({
  ...DEMO_SONG, texture: "fingerstyle",
  sections: [{ name: "A", note: "", bars: [{ chords: DEMO_SONG.sections[0].bars[0].chords.slice(0, 1).map((c) => ({ ...c, rhythm: [{ value: 1, dotted: false, play: "all" }] })), beats }] }],
});

describe("fingerings", () => {
  it("fingers an open C chord like a guitarist (3-2-1) with p-i-m-a", () => {
    const f = computeFingerings(songOf([beat([n(5, 3), n(4, 2), n(3, 0), n(2, 1), n(1, 0)], 1)]));
    const at0 = (s: number) => f.get(fingeringKey(0, 0, s))!;
    expect([at0(5).lh, at0(4).lh, at0(2).lh]).toEqual([3, 2, 1]);
    expect(at0(5).rh).toBe("p");
    expect([at0(3).rh, at0(2).rh, at0(1).rh]).toEqual(["i", "m", "a"]);
  });
  it("plays the G chord 320003 without an impossible mini-barre", () => {
    const f = computeFingerings(songOf([beat([n(6, 3), n(5, 2), n(4, 0), n(3, 0), n(2, 0), n(1, 3)], 1)]));
    const g = (s: number) => f.get(fingeringKey(0, 0, s))!.lh;
    expect(g(5)).toBeLessThan(g(6));
    expect(g(6)).not.toBe(g(1));
  });
  it("alternates i and m on a single-note melody and skips legato notes", () => {
    const f = computeFingerings(songOf([beat([n(2, 1)]), beat([n(2, 3)]), beat([n(2, 5, "hammer")]), beat([n(2, 3)])]));
    const rh = [0, 1, 2, 3].map((i) => f.get(fingeringKey(0, i, 2))!.rh);
    expect(rh[0]).not.toBe(rh[1]);
    expect(rh[2]).toBeNull();
  });
  it("never uses one finger on two different frets in a beat", () => {
    const f = computeFingerings(songOf([beat([n(6, 5), n(4, 7), n(3, 7), n(2, 6), n(1, 5)], 1)]));
    const byFinger = new Map<number, Set<number>>();
    for (const [s, fret] of [[6, 5], [4, 7], [3, 7], [2, 6], [1, 5]]) {
      const lh = f.get(fingeringKey(0, 0, s))!.lh;
      byFinger.set(lh, new Set([...(byFinger.get(lh) ?? []), fret]));
    }
    for (const frets of byFinger.values()) expect(frets.size).toBe(1);
  });
  it("renders finger numbers in alphaTab", () => {
    const song = songOf([beat([n(5, 3), n(4, 2), n(2, 1)], 1)]);
    const imp = new at.importer.AlphaTexImporter();
    imp.initFromString(songToAlphaTex(song, "tabs", "nylon", { fingering: true }).tex, new at.Settings());
    const notes = imp.readScore().tracks[0].staves[0].bars[0].voices[0].beats[0].notes;
    const bySt = new Map(notes.map((x) => [x.string, x]));
    // alphaTab strings are numbered low → high from 1; Fingers enum: 1 = index … 4 = little, 0 = thumb.
    expect([...bySt.values()].map((x) => x.leftHandFinger).sort()).toEqual([1, 2, 3]);
    expect([...bySt.values()].some((x) => x.rightHandFinger === 0)).toBe(true);
  });
});
