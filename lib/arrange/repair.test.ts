import { describe, expect, it } from "vitest";
import { DEMO_SONG } from "@/lib/ir/demo";
import { barErrors, repairPrompt, spliceBars } from "./repair";
import type { Song } from "@/lib/ir/schema";

const clone = (s: Song): Song => JSON.parse(JSON.stringify(s));

describe("targeted bar repair", () => {
  it("finds no errors in a clean song", () => {
    const r = barErrors(DEMO_SONG, { fidelity: "exact", texture: "comping" });
    expect(r.global).toEqual([]);
    expect(r.perBar.size).toBe(0);
  });
  it("locates a broken bar by its global index", () => {
    const s = clone(DEMO_SONG);
    const bars = s.sections.flatMap((x) => x.bars);
    bars[3].chords[0].rhythm = []; // empty rhythm → bar 3 broken
    const r = barErrors(s, { fidelity: "exact", texture: "comping" });
    expect([...r.perBar.keys()]).toEqual([3]);
    expect(repairPrompt(s, r.perBar)).toContain("bar index 3");
  });
  it("reports song-level problems separately", () => {
    const r = barErrors(DEMO_SONG, { fidelity: "exact", texture: "fingerstyle" });
    expect(r.global.length).toBeGreaterThan(0);
  });
  it("splices fixed bars back and renames colliding chord ids", () => {
    const s = clone(DEMO_SONG);
    const bars = s.sections.flatMap((x) => x.bars);
    const fixed = clone(DEMO_SONG).sections.flatMap((x) => x.bars)[0]; // reuses bar 0's chord ids at index 3
    const out = spliceBars(s, [{ index: 3, bar: fixed }]);
    const outBars = out.sections.flatMap((x) => x.bars);
    expect(outBars[3].chords.map((c) => c.symbol)).toEqual(fixed.chords.map((c) => c.symbol));
    const ids = outBars.flatMap((b) => b.chords.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(outBars[0]).toEqual(bars[0]);
  });
});
