import type { Song, TabBeat } from "@/lib/ir/schema";
import { barBeats, eventBeats } from "@/lib/theory/validate";

/**
 * "Why this is cool": deterministic detection of the signature moments in a fingerstyle tab,
 * with a concrete practice tip and the bar range to loop. Nothing here asks a model.
 */
export type MomentKind = "harmonics" | "slap-groove" | "fast-run" | "triplet-fill" | "legato" | "campanella" | "tapping" | "finale";
export type Moment = { kind: MomentKind; title: string; startBar: number; endBar: number; how: string; speed: number };

type BarInfo = { beats: TabBeat[]; perBar: number };

const KIND_ORDER: MomentKind[] = ["harmonics", "slap-groove", "tapping", "fast-run", "triplet-fill", "legato", "campanella", "finale"];

function detectBar(b: BarInfo, tempo: number): MomentKind[] {
  const kinds: MomentKind[] = [];
  const notes = b.beats.flatMap((x) => x.notes);
  if (notes.filter((n) => n.technique === "harmonic" || n.technique === "artificial-harmonic").length >= 2) kinds.push("harmonics");
  if (b.beats.filter((x) => x.percussion !== "none").length >= 2) kinds.push("slap-groove");
  if (notes.some((n) => n.technique === "tap")) kinds.push("tapping");
  // A run: ≥ 6 consecutive single notes at ≥ 6 notes/second.
  let run = 0, best = 0;
  for (const x of b.beats) {
    const fast = x.notes.length === 1 && (eventBeats(x) * 60) / tempo <= 1 / 6;
    run = fast ? run + 1 : 0;
    best = Math.max(best, run);
  }
  if (best >= 6) kinds.push("fast-run");
  if (b.beats.filter((x) => x.triplet && x.notes.length).length >= 3) kinds.push("triplet-fill");
  if (notes.filter((n) => n.technique === "hammer" || n.technique === "pull").length >= 3) kinds.push("legato");
  // Campanella: ≥ 4 consecutive single notes, each on a different string from the last, with open strings ringing.
  let camp = 0, opens = 0, bestCamp = 0, prev = 0;
  for (const x of b.beats) {
    if (x.notes.length === 1 && x.notes[0].string !== prev) {
      camp++; opens += x.notes[0].fret === 0 ? 1 : 0; prev = x.notes[0].string;
      if (camp >= 4 && opens >= 2) bestCamp = camp;
    } else { camp = x.notes.length === 1 ? 1 : 0; opens = 0; prev = x.notes[0]?.string ?? 0; }
  }
  if (bestCamp >= 4) kinds.push("campanella");
  return kinds;
}

const COPY: Record<MomentKind, { title: string; how: string; speed: number }> = {
  harmonics: { title: "Harmonic chime", how: "Touch the string right above the fret wire, don't press, pluck firmly near the bridge, then lift. For harp harmonics, the index tip touches 12 frets above while the ring finger plucks.", speed: 0.7 },
  "slap-groove": { title: "Slap groove", how: "Thumb slaps the bass strings on the backbeat and bounces off. Loop it with only the thumb and percussion first, then add the melody.", speed: 0.6 },
  tapping: { title: "Tapped notes", how: "Hammer the fret hard with the picking-hand middle finger, then flick off sideways to sound the note below.", speed: 0.6 },
  "fast-run": { title: "Fast run", how: "Practise it in groups of 3–4 notes, stopping on the first note of each group, then join the groups. Speed up 5% per clean pass.", speed: 0.6 },
  "triplet-fill": { title: "Triplet fill", how: "Count 'tri-pl-et' aloud and land the next downbeat exactly on time. The fill must not rush.", speed: 0.65 },
  legato: { title: "Hammer-on/pull-off lick", how: "Pluck only the first note; the fretting hand does the rest. Hammer from the fingertip and pull slightly sideways to keep the volume even.", speed: 0.65 },
  campanella: { title: "Campanella run", how: "Let every note ring into the next, like bells. Keep fretted notes held and don't damp the open strings.", speed: 0.7 },
  finale: { title: "Big ending", how: "Take a breath before the last chord, let it ring, and hold the pose for the camera.", speed: 0.8 },
};

export function detectMoments(song: Song): Moment[] {
  if (song.texture !== "fingerstyle") return [];
  const perBar = barBeats(song.timeSignature);
  const bars: BarInfo[] = song.sections.flatMap((s) => s.bars.map((b) => ({ beats: b.beats, perBar })));
  const byKind = new Map<MomentKind, number[]>();
  bars.forEach((b, i) => detectBar(b, song.tempo).forEach((k) => byKind.set(k, [...(byKind.get(k) ?? []), i])));
  const last = bars.at(-1);
  if (last && last.beats.some((x) => x.notes.length >= 4 || x.notes.some((n) => n.technique.includes("harmonic")))) byKind.set("finale", [bars.length - 1]);

  const out: Moment[] = [];
  for (const kind of KIND_ORDER) {
    const idx = byKind.get(kind);
    if (!idx?.length) continue;
    // First contiguous run of bars (extended by one bar of context, max 4 bars).
    let end = idx[0];
    while (idx.includes(end + 1) && end - idx[0] < 3) end++;
    const extra = idx.length > end - idx[0] + 1 ? ` (+${idx.length - (end - idx[0] + 1)} more bar${idx.length - (end - idx[0] + 1) > 1 ? "s" : ""})` : "";
    out.push({ kind, ...COPY[kind], title: COPY[kind].title + extra, startBar: idx[0], endBar: end });
  }
  return out;
}
