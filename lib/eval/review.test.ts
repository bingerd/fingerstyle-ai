import { describe, expect, it } from "vitest";
import { keyScale, outsideKeyShare, reviewSong } from "./review";
import { EVAL_TUNES } from "@/eval/tunes";
import { DEMO_SONG } from "@/lib/ir/demo";
import type { Song, TabBeat } from "@/lib/ir/schema";
import type { Tune } from "@/lib/tune/tune";
import { STANDARD_TUNING, errorsOnly, validateAgainstTune } from "@/lib/theory/validate";
import { Controls, directionFromControls, lockDirection, needsPlan, validatePlan, type Direction } from "@/lib/arrange/plan";

/** Single-string arrangement of a tune's melody; `late` delays every note after the first of each bar by an 8th. */
function songFromTune(tune: Tune, late = false): Song {
  const toBeats = (b: Tune["bars"][number]): TabBeat[] => {
    const beats: TabBeat[] = [];
    const ev = (value: 1 | 2 | 4 | 8 | 16, dotted: boolean, midi: number | null): TabBeat => ({
      value, dotted, triplet: false, percussion: "none", chord: "",
      notes: midi === null ? [] : [{ string: midi >= 64 ? 1 : midi >= 59 ? 2 : 3, fret: midi - STANDARD_TUNING[6 - (midi >= 64 ? 1 : midi >= 59 ? 2 : 3)], technique: "none" }],
    });
    const val = (d: number) => (d === 4 ? [1, false] : d === 3 ? [2, true] : d === 2 ? [2, false] : d === 1.5 ? [4, true] : d === 1 ? [4, false] : d === 0.5 ? [8, false] : [16, false]) as [1 | 2 | 4 | 8 | 16, boolean];
    b.melody.forEach((n, i) => {
      if (late && i > 0 && n.dur >= 1) {
        // Delay by an 8th: hold the previous note longer (approximation: insert a rest of an 8th before).
        beats.push(ev(8, false, null));
        const [v, d] = val(n.dur - 0.5);
        beats.push(ev(v, d, n.midi));
      } else {
        const [v, d] = val(n.dur);
        beats.push(ev(v, d, n.midi));
      }
    });
    return beats;
  };
  const chords = DEMO_SONG.sections[0].bars[0].chords;
  return { ...DEMO_SONG, texture: "fingerstyle", sections: [{ name: "A", note: "", bars: tune.bars.map((b) => ({ chords, beats: toBeats(b) })) }] };
}

describe("melody fidelity modes", () => {
  const ode = EVAL_TUNES[0].tune;
  it("exact accepts the exact melody", () => {
    expect(errorsOnly(validateAgainstTune(songFromTune(ode), ode))).toHaveLength(0);
  });
  it("embellished accepts notes displaced by half a beat; exact rejects them", () => {
    const late = songFromTune(ode, true);
    expect(errorsOnly(validateAgainstTune(late, ode, undefined, "exact")).length).toBeGreaterThan(0);
    expect(errorsOnly(validateAgainstTune(late, ode, undefined, "embellished"))).toHaveLength(0);
  });
  it("embellished still rejects a different tune", () => {
    const twinkle = songFromTune(EVAL_TUNES[1].tune);
    expect(errorsOnly(validateAgainstTune(twinkle, ode, undefined, "embellished")).length).toBeGreaterThan(0);
  });
});

describe("reviewSong", () => {
  const ode = EVAL_TUNES[0].tune;
  it("marks the melody verified with a tune and unverified without", () => {
    const song = songFromTune(ode);
    const withTune = reviewSong(song, { tune: ode }).criteria.find((c) => c.key === "melody")!;
    expect(withTune).toMatchObject({ status: "verified", score: 1 });
    const without = reviewSong(song).criteria.find((c) => c.key === "melody")!;
    expect(without).toMatchObject({ status: "unverified", score: null });
  });
  it("ranks the right melody above the wrong one", () => {
    const right = reviewSong(songFromTune(ode), { tune: ode }).overall;
    const wrong = reviewSong(songFromTune(EVAL_TUNES[1].tune), { tune: ode }).overall;
    expect(right).toBeGreaterThan(wrong);
  });
  it("reviews a comping song with harmony and voice-leading scores", () => {
    const r = reviewSong(DEMO_SONG, { prefs: { reharm: "light" } });
    const keys = r.criteria.filter((c) => c.score !== null).map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["harmony", "voiceLeading", "playability", "reharm"]));
    expect(r.overall).toBeGreaterThan(0.5);
  });
});

describe("key analysis", () => {
  it("parses keys", () => {
    expect([...keyScale("C major")!].sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(keyScale("Ebm")!.has(6)).toBe(true); // Gb
    expect(keyScale("Bb major")!.has(3)).toBe(true); // Eb
    expect(keyScale("???")).toBeNull();
  });
  it("counts chords outside the key", () => {
    const r = outsideKeyShare(DEMO_SONG)!;
    expect(r.total).toBeGreaterThan(0);
    expect(r.share).toBeGreaterThanOrEqual(0);
  });
});

describe("arrangement planning controls", () => {
  const base = Controls.parse({});
  it("defaults everything to auto, which needs a plan", () => {
    expect(base.style).toBe("auto");
    expect(needsPlan(base)).toBe(true);
  });
  it("skips planning when the player fixed every choice for one arrangement", () => {
    const fixed = Controls.parse({ style: "Bossa nova", flair: "clean", difficulty: "beginner", reharm: "none", fidelity: "exact" });
    expect(needsPlan(fixed)).toBe(false);
    expect(directionFromControls(fixed)).toMatchObject({ style: "Bossa nova", flair: "clean", reharm: "none" });
  });
  it("locks player choices over the planner's", () => {
    const planned: Direction = { name: "x", style: "Jazz", flair: "showstopper", difficulty: "advanced", reharm: "bold", fidelity: "free", concept: "c", devices: [] };
    const c = Controls.parse({ reharm: "none", fidelity: "exact" });
    expect(lockDirection(planned, c)).toMatchObject({ style: "Jazz", reharm: "none", fidelity: "exact" });
  });
  it("rejects duplicate directions", () => {
    const d: Direction = { name: "a", style: "Jazz", flair: "clean", difficulty: "beginner", reharm: "none", fidelity: "exact", concept: "c", devices: [] };
    expect(errorsOnly(validatePlan({ analysis: { mood: "", melody: "", harmony: "", rhythm: "", hooks: "" }, directions: [d, { ...d, name: "b" }] }, 2))).toHaveLength(1);
  });
});
