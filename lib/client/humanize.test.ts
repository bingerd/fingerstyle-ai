import { describe, expect, it } from "vitest";
import * as at from "@coderline/alphatab";
import { humanize } from "./humanize";
import { songToAlphaTex } from "@/lib/alphatex/fromIR";
import { DEMO_SONG } from "@/lib/ir/demo";
import type { Song } from "@/lib/ir/schema";

const fingerstyle: Song = {
  ...DEMO_SONG,
  texture: "fingerstyle",
  sections: [{
    name: "A", note: "",
    bars: [{
      chords: DEMO_SONG.sections[0].bars[0].chords.slice(0, 1).map((c) => ({ ...c, rhythm: [{ value: 1, dotted: false, play: "all" }] })),
      beats: [
        { value: 2, dotted: false, triplet: false, percussion: "none", chord: "", notes: [
          { string: 6, fret: 3, technique: "none" }, { string: 4, fret: 2, technique: "none" }, { string: 3, fret: 0, technique: "none" }, { string: 1, fret: 3, technique: "none" },
        ] },
        { value: 2, dotted: false, triplet: false, percussion: "none", chord: "", notes: [{ string: 5, fret: 3, technique: "none" }, { string: 2, fret: 1, technique: "none" }] },
      ],
    }],
  }],
};

function load(song: Song) {
  const settings = new at.Settings();
  const imp = new at.importer.AlphaTexImporter();
  imp.initFromString(songToAlphaTex(song, "tabs").tex, settings);
  return { score: imp.readScore(), settings };
}

describe("expressive playback", () => {
  it("voices the melody above bass and inner voices and rolls big chords", () => {
    const { score } = load(fingerstyle);
    humanize(at, score);
    const [b1, b2] = score.tracks[0].staves[0].bars[0].voices[0].beats;
    const dyn = (b: typeof b1) => [...b.notes].sort((x, y) => x.realValue - y.realValue).map((n) => n.dynamics);
    const D = at.model.DynamicValue;
    expect(dyn(b1)).toEqual([D.MF, D.P, D.P, D.FF]); // bass, inner, inner, melody on the downbeat
    expect(dyn(b2)).toEqual([D.MF, D.F]);
    expect(b1.brushType).toBe(at.model.BrushType.ArpeggioUp);
    expect(b2.brushType).toBe(at.model.BrushType.None);
  });
  it("exports a Guitar Pro file that round-trips the notes and frets", () => {
    const { score, settings } = load(fingerstyle);
    humanize(at, score);
    const bytes = new at.exporter.Gp7Exporter().export(score, settings);
    expect(bytes.length).toBeGreaterThan(1000);
    const back = at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
    const frets = (s: typeof score) => s.tracks[0].staves[0].bars[0].voices[0].beats.map((b) => b.notes.map((n) => `${n.string}:${n.fret}`).sort().join(" "));
    expect(frets(back)).toEqual(frets(score));
  });
});
