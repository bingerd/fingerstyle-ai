import { describe, expect, it } from "vitest";
import * as alphaTab from "@coderline/alphatab";
import { Midi } from "@tonejs/midi";
import { songToAlphaTex } from "@/lib/alphatex/fromIR";
import { rawFromAlphaTab, rawFromMidi } from "@/lib/tune/importers";
import { guessMelodyTrack, toTune, tuneToText } from "@/lib/tune/tune";
import { errorsOnly, tabMidi, validateAgainstTune, validateBeats, validateSong } from "@/lib/theory/validate";
import { replaceChord } from "@/lib/ir/edit";
import { normalizeSong } from "@/lib/ir/normalize";
import { DEMO_SONG } from "@/lib/ir/demo";
import type { Song, TabBeat } from "@/lib/ir/schema";

// Melody: bar 1 = E4 G4 (half notes), bar 2 = C5 whole note; plus a bass track.
function makeMidi(): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(100);
  const ppq = midi.header.ppq;
  const mel = midi.addTrack();
  mel.name = "Lead";
  mel.addNote({ midi: 64, ticks: 0, durationTicks: ppq * 2 });
  mel.addNote({ midi: 60, ticks: 0, durationTicks: ppq * 2 }); // lower note at same onset → skyline drops it
  mel.addNote({ midi: 67, ticks: ppq * 2, durationTicks: ppq * 2 });
  mel.addNote({ midi: 72, ticks: ppq * 4, durationTicks: ppq * 4 });
  const bass = midi.addTrack();
  bass.name = "Bass";
  bass.addNote({ midi: 36, ticks: 0, durationTicks: ppq * 4 });
  bass.addNote({ midi: 41, ticks: ppq * 4, durationTicks: ppq * 4 });
  return midi.toArray();
}

const beat = (value: 1 | 2 | 4 | 8 | 16, notes: [number, number][], chord = ""): TabBeat => ({
  value, dotted: false, triplet: false, percussion: "none", notes: notes.map(([string, fret]) => ({ string, fret, technique: "none" as const })), chord,
});

const fingerstyleSong = (bar1: TabBeat[], bar2: TabBeat[]): Song => ({
  ...DEMO_SONG,
  texture: "fingerstyle",
  transpose: 0,
  sections: [{
    name: "A", note: "",
    bars: [
      { chords: [{ ...DEMO_SONG.sections[0].bars[2].chords[0], id: "c1", symbol: "C", voicing: { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] }, rhythm: [{ value: 1, dotted: false, play: "all" }] }], beats: bar1 },
      { chords: [{ ...DEMO_SONG.sections[0].bars[2].chords[0], id: "c2", symbol: "F", voicing: { frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1] }, rhythm: [{ value: 1, dotted: false, play: "all" }] }], beats: bar2 },
    ],
  }],
});

describe("tune import", () => {
  const raw = rawFromMidi(makeMidi(), "test");
  it("guesses the melody track and slices bars with a skyline", () => {
    expect(guessMelodyTrack(raw)).toBe(0);
    const tune = toTune(raw, 0, 0, 2);
    expect(tune.bars[0].melody).toEqual([{ start: 0, dur: 2, midi: 64 }, { start: 2, dur: 2, midi: 67 }]);
    expect(tune.bars[1].melody).toEqual([{ start: 0, dur: 4, midi: 72 }]);
    expect(tune.bars[0].bass).toEqual([36]);
    expect(tuneToText(tune)).toContain("bar 1: E4@0(2) G4@2(2)");
  });

  it("supports a bar offset", () => {
    expect(toTune(raw, 0, 1, 1).bars[0].melody[0].midi).toBe(72);
  });

  it("imports scores loaded by alphaTab (Guitar Pro / MusicXML path)", () => {
    const score = alphaTab.importer.ScoreLoader.loadAlphaTex('\\track "Lead" . 0.1.2 3.1.2 | 8.1.1');
    const tune = toTune(rawFromAlphaTab(score, "x"), 0, 0, 2);
    expect(tune.bars[0].melody.map((n) => n.midi)).toEqual([64, 67]);
    expect(tune.bars[1].melody.map((n) => n.midi)).toEqual([72]);
  });
});

describe("fingerstyle validation", () => {
  const tune = toTune(rawFromMidi(makeMidi(), "t"), 0, 0, 2);
  // E4 = string 1 open, G4 = string 1 fret 3, C5 = string 1 fret 8 / string 2 fret 13
  const good = fingerstyleSong(
    [beat(4, [[1, 0], [5, 3]]), beat(4, [[2, 1]]), beat(4, [[1, 3], [4, 2]]), beat(4, [[2, 1]])],
    [beat(1, [[1, 8], [6, 8]])],
  );

  it("accepts tab whose top notes match the melody", () => {
    expect(tabMidi(1, 0)).toBe(64);
    expect(errorsOnly([...validateSong(good), ...validateAgainstTune(good, tune)])).toEqual([]);
  });

  it("flags a wrong top note and a missing attack", () => {
    const bad = fingerstyleSong(
      [beat(2, [[1, 1]]), beat(2, [[2, 1]])],          // F4 instead of E4; no attack at G4 problem? (attack exists but top is C4)
      [beat(2, [[3, 0]]), beat(2, [[1, 8]])],           // C5 should start at beat 1 but top there is G3
    );
    const msgs = errorsOnly(validateAgainstTune(bad, tune)).map((i) => i.message);
    expect(msgs.some((m) => /should be melody E4, tab has F4/.test(m))).toBe(true);
    expect(msgs.some((m) => /should be melody C5/.test(m))).toBe(true);
    const shifted = fingerstyleSong([beat(1, [[1, 0]])], [beat(1, [[1, 8]])]);
    expect(errorsOnly(validateAgainstTune(shifted, tune)).some((i) => /no attack/.test(i.message))).toBe(true);
  });

  it("checks transposed arrangements", () => {
    const up2 = fingerstyleSong(
      [beat(2, [[1, 2]]), beat(2, [[1, 5]])],
      [beat(1, [[1, 10]])],
    );
    expect(errorsOnly(validateAgainstTune({ ...up2, transpose: 2 }, tune))).toEqual([]);
  });

  it("rejects bad timing, duplicate strings and stretches", () => {
    expect(errorsOnly(validateBeats([beat(2, [[1, 0]])], 4, [], "x")).length).toBe(1);
    expect(errorsOnly(validateBeats([beat(1, [[1, 0], [1, 3]])], 4, [], "x")).length).toBe(1);
    expect(errorsOnly(validateBeats([beat(1, [[1, 1], [6, 9]])], 4, [], "x")).length).toBe(1);
  });

  it("renders tab beats to alphaTex with chord labels, let-ring and the nylon program", () => {
    const { tex, beatRefs } = songToAlphaTex(good, "both", "nylon");
    const score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex);
    expect(score.tracks[0].playbackInfo.program).toBe(24);
    const b0 = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
    expect(b0.chord?.name).toBe("C");
    expect(Math.max(...b0.notes.map((n) => n.realValue))).toBe(64);
    expect(b0.notes.every((n) => n.isLetRing)).toBe(true);
    expect(beatRefs.map((r) => r.chordId)).toEqual(["c1", "c1", "c1", "c1", "c2"]);
  });

  it("strums comping chords (brush down on the beat)", () => {
    const score = alphaTab.importer.ScoreLoader.loadAlphaTex(songToAlphaTex(DEMO_SONG).tex);
    const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
    expect(beats.filter((b) => b.notes.length >= 3).every((b) => b.brushType !== 0)).toBe(true);
  });

  it("reharm can replace a fingerstyle bar's tab", () => {
    const next = replaceChord(good, "c2", [{ ...good.sections[0].bars[1].chords[0], symbol: "Fmaj7" }], [beat(1, [[1, 8]])]);
    expect(next.sections[0].bars[1].beats).toHaveLength(1);
    expect(next.sections[0].bars[0].beats).toHaveLength(4);
  });

  it("upgrades songs saved before fingerstyle support", () => {
    const old = structuredClone(DEMO_SONG) as unknown as Record<string, unknown>;
    delete old.texture;
    delete old.transpose;
    (old.sections as { bars: Record<string, unknown>[] }[]).forEach((s) => s.bars.forEach((b) => delete b.beats));
    const up = normalizeSong(old);
    expect(up.texture).toBe("comping");
    expect(up.sections[0].bars[0].beats).toEqual([]);
  });
});

describe("modern fingerstyle techniques", () => {
  const n = (string: number, fret: number, technique: TabBeat["notes"][number]["technique"] = "none") => ({ string, fret, technique });
  const b = (value: TabBeat["value"], notes: TabBeat["notes"], extra: Partial<TabBeat> = {}): TabBeat => ({
    value, dotted: false, triplet: false, percussion: "none", notes, chord: "", ...extra,
  });
  const songWith = (beats: TabBeat[], extra: Partial<Song> = {}): Song => ({
    ...fingerstyleSong(beats, [b(1, [n(1, 0)])]), ...extra,
  });

  it("renders hammer-ons/slides on the origin note, harmonics, taps, triplets and slaps", () => {
    const beats = [
      b(8, [n(3, 2)]), b(8, [n(3, 4, "hammer")]),
      b(8, [n(2, 5)]), b(8, [n(2, 7, "slide")]),
      b(8, [n(1, 12, "harmonic")], { triplet: true }), b(8, [n(1, 7, "harmonic")], { triplet: true }), b(8, [n(1, 12, "tap")], { triplet: true }),
      b(4, [n(1, 3, "vibrato")], { percussion: "slap" }),
    ];
    // 8+8+8+8 = 2 beats, triplet 8ths = 1 beat, quarter = 1 beat → 4/4
    const song = songWith(beats, { tuning: "dadgad", capo: 2 });
    // Bar 2's helper chord is a standard-tuning F grip, which (correctly) fails in DADGAD; check bar 1 only.
    expect(errorsOnly(validateSong(song)).filter((i) => i.where.startsWith("A bar 1"))).toEqual([]);
    const score = alphaTab.importer.ScoreLoader.loadAlphaTex(songToAlphaTex(song).tex);
    const staff = score.tracks[0].staves[0];
    expect(staff.capo).toBe(2);
    expect(staff.tuning).toEqual([62, 57, 55, 50, 45, 38]);
    const beatsOut = staff.bars[0].voices[0].beats;
    expect(beatsOut[0].notes[0].isHammerPullOrigin).toBe(true);
    expect(beatsOut[2].notes[0].slideOutType).not.toBe(0);
    expect(beatsOut[4].notes[0].harmonicType).not.toBe(0);
    expect(beatsOut[4].tupletNumerator).toBe(3);
    expect(beatsOut[6].tap).toBe(true);
    expect(beatsOut[7].notes.some((x) => x.isDead)).toBe(true);
    expect(beatsOut[7].text).toBe("slap");
  });

  it("uses tuning, capo and harmonics for sounding pitch; dead notes don't count as melody", () => {
    const tune = { title: "t", tempo: 90, timeSignature: { numerator: 4, denominator: 4 }, bars: [
      { melody: [{ start: 0, dur: 2, midi: 64 + 2 + 12 }, { start: 2, dur: 2, midi: 64 }], chords: [], accompaniment: [], bass: [] },
    ] };
    const song = songWith([b(2, [n(1, 12, "artificial-harmonic"), n(6, 0, "dead")]), b(2, [n(1, 0)])], { tuning: "dadgad", capo: 2 });
    // DADGAD + capo 2: string 1 open sounds E4 (64), so beat 3 matches. Beat 1: an artificial harmonic at
    // fret 12 sounds 62+2+12+12 = 88 (E6), not the wanted F#5 (78); the dead note is ignored.
    const issues = errorsOnly(validateAgainstTune(song, tune, 0));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/should be melody F#5, tab has E6/);
  });

  it("flags impossible legato and fake harmonics", () => {
    const issues = errorsOnly(validateBeats([b(2, [n(1, 5)]), b(4, [n(1, 3, "hammer")]), b(4, [n(2, 6, "harmonic")])], 4, [], "x"));
    expect(issues.map((i) => i.message).join(" ")).toMatch(/hammer-on must go up/);
    expect(issues.map((i) => i.message).join(" ")).toMatch(/no natural harmonic at fret 6/);
  });

  it("upgrades older fingerstyle songs (no techniques/percussion/tuning)", () => {
    const old = JSON.parse(JSON.stringify(fingerstyleSong([b(1, [n(1, 0)])], [b(1, [n(1, 0)])])));
    delete old.tuning; delete old.capo;
    for (const bar of old.sections[0].bars) for (const beat of bar.beats) { delete beat.triplet; delete beat.percussion; for (const x of beat.notes) delete x.technique; }
    const up = normalizeSong(old);
    expect(up.tuning).toBe("standard");
    expect(up.sections[0].bars[0].beats[0]).toMatchObject({ triplet: false, percussion: "none" });
  });
});
