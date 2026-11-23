import { describe, expect, it } from "vitest";
import * as alphaTab from "@coderline/alphatab";
import { DEMO_SONG } from "@/lib/ir/demo";
import { replaceChord } from "@/lib/ir/edit";
import { songToAlphaTex } from "@/lib/alphatex/fromIR";
import { errorsOnly, validateChord, validateSong } from "@/lib/theory/validate";
import type { ChordEvent } from "@/lib/ir/schema";

const chord = (symbol: string, frets: number[]): ChordEvent => ({
  id: "x", symbol, roman: "", voicing: { frets, fingers: [0, 0, 0, 0, 0, 0] },
  rhythm: [{ value: 1, dotted: false, play: "all" }],
});

describe("voicing validator", () => {
  it.each([
    ["C", [-1, 3, 2, 0, 1, 0]],
    ["Cmaj7", [-1, 3, 2, 0, 0, 0]],
    ["G7", [3, 2, 0, 0, 0, 1]],
    ["F#m7b5", [2, -1, 2, 2, 1, -1]],
    ["C/E", [0, 3, 2, 0, 1, 0]],
    ["D7alt", [-1, 5, 4, 5, 6, 6]],
    ["A5", [-1, 0, 2, 2, -1, -1]],
  ])("accepts %s", (symbol, frets) => {
    expect(errorsOnly(validateChord(chord(symbol, frets), symbol))).toEqual([]);
  });

  it("rejects impossible stretches", () => {
    expect(errorsOnly(validateChord(chord("C", [-1, 3, 9, 0, 1, 0]), "C")).length).toBeGreaterThan(0);
  });
  it("rejects a voicing missing the 3rd", () => {
    expect(errorsOnly(validateChord(chord("C", [-1, 3, 5, 5, -1, -1]), "C")).map((i) => i.message).join()).toMatch(/guide tone/);
  });
  it("rejects wrong slash bass", () => {
    expect(errorsOnly(validateChord(chord("C/E", [-1, 3, 2, 0, 1, 0]), "C/E")).length).toBe(1);
  });
  it("rejects unknown symbols", () => {
    expect(errorsOnly(validateChord(chord("Qzz7", [-1, 3, 2, 0, 1, 0]), "x")).length).toBe(1);
  });
});

describe("song", () => {
  it("demo song is valid", () => {
    expect(errorsOnly(validateSong(DEMO_SONG))).toEqual([]);
  });

  it("flags bars whose rhythm doesn't fill the bar", () => {
    const bad = structuredClone(DEMO_SONG);
    bad.sections[0].bars[0].chords[0].rhythm = [{ value: 2, dotted: false, play: "all" }];
    expect(errorsOnly(validateSong(bad)).some((i) => /beats/.test(i.message))).toBe(true);
  });

  it("converts to alphaTex that alphaTab parses with the right frets and chord names", () => {
    const { tex, beatRefs } = songToAlphaTex(DEMO_SONG);
    const score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex);
    const bars = score.tracks[0].staves[0].bars;
    expect(bars.length).toBe(8);
    const first = bars[0].voices[0].beats[0];
    // Bossa pattern starts with the bass: Dm9 lowest sounding string is A (string 5), fret 5.
    expect(first.notes.map((n) => n.fret)).toEqual([5]);
    expect(first.chord?.name).toBe("Dm9");
    expect(beatRefs.length).toBe(bars.reduce((n, b) => n + b.voices[0].beats.length, 0));
    expect(score.masterBars[4].section?.text).toBe("B");
  });

  it("replaceChord swaps a slot for multiple chords with unique ids", () => {
    const sub = [chord("Ab7", [4, -1, 4, 5, 4, -1]), chord("G7", [3, -1, 3, 4, 3, -1])].map((c) => ({
      ...c, rhythm: [{ value: 2 as const, dotted: false, play: "all" as const }],
    }));
    const next = replaceChord(DEMO_SONG, "c2", sub);
    const ids = next.sections.flatMap((s) => s.bars.flatMap((b) => b.chords.map((c) => c.id)));
    expect(new Set(ids).size).toBe(ids.length);
    expect(next.sections[0].bars[1].chords.map((c) => c.symbol)).toEqual(["Ab7", "G7"]);
    expect(errorsOnly(validateSong(next))).toEqual([]);
  });
});
