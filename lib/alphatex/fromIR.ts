import type { ChordEvent, RhythmEvent, Song, TabNote } from "@/lib/ir/schema";
import { TUNINGS } from "@/lib/theory/validate";

/**
 * Deterministic Song IR → alphaTex conversion.
 * alphaTex strings are numbered high e = 1 … low E = 6, while the IR lists
 * frets low E first, so string number = 6 - index.
 */

export type BeatRef = { chordId: string; barIndex: number };

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Chord diagram name, unique per (symbol, voicing) so two voicings of one symbol both get diagrams. */
export function diagramName(ch: ChordEvent, registry: Map<string, string>): string {
  const key = `${ch.symbol}|${ch.voicing.frets.join(",")}`;
  const existing = registry.get(key);
  if (existing) return existing;
  const taken = new Set(registry.values());
  let name = ch.symbol;
  // alphaTab looks chords up case-insensitively, so pad duplicates with primes.
  while ([...taken].some((t) => t.toLowerCase() === name.toLowerCase())) name += "'";
  registry.set(key, name);
  return name;
}

function notesFor(frets: number[], play: RhythmEvent["play"]): string[] {
  const sounding = frets.map((f, i) => ({ f, string: 6 - i })).filter((n) => n.f >= 0);
  if (!sounding.length || play === "rest") return [];
  const pick = play === "bass" ? sounding.slice(0, 1) : play === "upper" ? sounding.slice(1) : sounding;
  return (pick.length ? pick : sounding).map((n) => `${n.f}.${n.string}`);
}

function beatTex(notes: string[], e: { value: number; dotted: boolean; triplet?: boolean }, props: string[]): string {
  const head = notes.length === 0 ? "r" : notes.length === 1 ? notes[0] : `(${notes.join(" ")})`;
  const allProps = [...(e.dotted ? ["d"] : []), ...(e.triplet ? ["tu 3"] : []), ...props];
  return `${head}.${e.value}${allProps.length ? ` {${allProps.join(" ")}}` : ""}`;
}

type NoteToken = { head: string; effects: string[] };

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const midiToTex = (m: number) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

/** Render one tab note; legato techniques are attached to the previous note on the same string. */
function noteToken(n: TabNote, lastOnString: Map<number, NoteToken>): NoteToken {
  const t: NoteToken = { head: n.technique === "dead" ? `x.${n.string}` : `${n.fret}.${n.string}`, effects: [] };
  const prev = lastOnString.get(n.string);
  switch (n.technique) {
    case "hammer":
    case "pull":
      if (prev && !prev.effects.includes("h")) prev.effects.push("h");
      break;
    case "slide":
      if (prev && !prev.effects.includes("sl")) prev.effects.push("sl");
      break;
    case "harmonic": t.effects.push("nh"); break;
    case "artificial-harmonic": t.effects.push("ah"); break;
    case "tap": t.effects.push("tt"); break;
    case "vibrato": t.effects.push("v"); break;
  }
  if (n.technique !== "dead") {
    t.effects.push("lr");
    lastOnString.set(n.string, t);
  }
  return t;
}

export type StaffView = "both" | "tabs" | "score";
/** "*-rec" = FreePats recorded guitars (npm run soundfonts:guitar), installed as spare GM programs 105/106. */
export type GuitarSound = "nylon" | "steel" | "jazz" | "clean" | "nylon-rec" | "steel-rec";
/** General MIDI programs (0-based). */
export const PROGRAM: Record<GuitarSound, number> = { nylon: 24, steel: 25, jazz: 26, clean: 27, "nylon-rec": 105, "steel-rec": 106 };

/** Strum direction: down on the beat, up on off-beats — like a real right hand. */
const brush = (pos: number) => (Math.abs(pos - Math.round(pos)) < 1e-6 ? "bd" : "bu");

export function songToAlphaTex(
  song: Song,
  view: StaffView = "both",
  sound: GuitarSound = "steel",
): { tex: string; beatRefs: BeatRef[] } {
  const registry = new Map<string, string>();
  const allChords = song.sections.flatMap((s) => s.bars.flatMap((b) => b.chords));
  for (const ch of allChords) diagramName(ch, registry);

  const header = [
    `\\title "${esc(song.title)}"`,
    `\\subtitle "${esc(song.style)}"`,
    `\\tempo ${song.tempo}`,
    ".",
    `\\track "Guitar"`,
    `\\staff {${view === "both" ? "score tabs" : view}}`,
    `\\instrument ${PROGRAM[sound]}`,
    `\\tuning (${[...(TUNINGS[song.tuning] ?? TUNINGS.standard)].reverse().map(midiToTex).join(" ")})`,
    ...(song.capo ? [`\\capo ${song.capo}`] : []),
    ...[...registry.entries()].map(([key, name]) => {
      const frets = key.split("|")[1].split(",").map(Number);
      // \\chord lists string 1 (high e) first; -1 = muted.
      return `\\chord ("${esc(name)}" ${[...frets].reverse().join(" ")})`;
    }),
  ];

  const beatRefs: BeatRef[] = [];
  const bars: string[] = [];
  // Hidden second track: real drum sounds for thumb slaps and body knocks (the tab shows them as x notes).
  const percBars: string[] = [];
  const hasPercussion = song.sections.some((s) => s.bars.some((b) => b.beats.some((bt) => bt.percussion !== "none")));
  // Last rendered note per string: hammer-ons, pull-offs and slides are marked on the origin note.
  const lastNote = new Map<number, NoteToken>();
  let barIndex = 0;
  song.sections.forEach((section) => {
    section.bars.forEach((bar, bi) => {
      const meta: string[] = [];
      if (barIndex === 0) meta.push(`\\ts ${song.timeSignature.numerator} ${song.timeSignature.denominator}`);
      if (bi === 0) meta.push(`\\section "${esc(section.name)}"`);
      const beats: ({ tokens: NoteToken[]; beat: { value: number; dotted: boolean; triplet?: boolean }; props: string[] } | string)[] = [];

      if (bar.beats.length) {
        const lastOnString = lastNote;
        // Fingerstyle: explicit tab. Chord labels go on the first beat at/after each chord's slot start.
        const slots: { ch: ChordEvent; start: number; end: number }[] = [];
        let p = 0;
        for (const ch of bar.chords) {
          const len = ch.rhythm.reduce((n, e) => n + (4 / e.value) * (e.dotted ? 1.5 : 1), 0);
          slots.push({ ch, start: p, end: p + len });
          p += len;
        }
        const labelled = new Set<string>();
        let pos = 0;
        for (const b of bar.beats) {
          const slot = slots.find((sl) => pos >= sl.start - 1e-6 && pos < sl.end - 1e-6) ?? slots.at(-1);
          const props: string[] = [];
          if (slot && !labelled.has(slot.ch.id)) {
            props.push(`ch "${esc(diagramName(slot.ch, registry))}"`);
            labelled.add(slot.ch.id);
          }
          const tokens = [...b.notes].sort((x, y) => x.string - y.string).map((n) => noteToken(n, lastOnString));
          // Percussion: a thumb slap / body knock is written as muted "x" notes on free bass strings.
          if (b.percussion !== "none") {
            const used = new Set(b.notes.map((n) => n.string));
            const hit = (b.percussion === "slap" ? [5, 6] : [6]).filter((st) => !used.has(st));
            tokens.push(...hit.map((st) => ({ head: `x.${st}`, effects: [] as string[] })));
            props.push(`txt "${b.percussion === "slap" ? "slap" : "body"}"`);
          }
          beats.push({ tokens, beat: b, props });
          beatRefs.push({ chordId: slot?.ch.id ?? "", barIndex });
          pos += (4 / b.value) * (b.dotted ? 1.5 : 1) * (b.triplet ? 2 / 3 : 1);
        }
      } else {
        // Comping: each chord's rhythm pattern; multi-note attacks are strummed.
        let pos = 0;
        for (const ch of bar.chords) {
          ch.rhythm.forEach((e, ei) => {
            const notes = notesFor(ch.voicing.frets, e.play);
            const props = ei === 0 ? [`ch "${esc(diagramName(ch, registry))}"`] : [];
            if (notes.length >= 3) props.push(brush(pos));
            beats.push(beatTex(notes, e, props));
            beatRefs.push({ chordId: ch.id, barIndex });
            pos += (4 / e.value) * (e.dotted ? 1.5 : 1);
          });
        }
      }
      if (hasPercussion)
        percBars.push(bar.beats.length
          ? bar.beats.map((b) => {
              const dur = [...(b.dotted ? ["d"] : []), ...(b.triplet ? ["tu 3"] : [])];
              if (b.percussion === "none") return `r.${b.value}${dur.length ? ` {${dur.join(" ")}}` : ""}`;
              const [sound, dy] = b.percussion === "slap" ? ["Snare (side stick)", "mf"] : ["Kick (hit)", "mp"];
              return `"${sound}".${b.value} {${[...dur, `dy ${dy}`].join(" ")}}`;
            }).join(" ")
          : `r.1`);
      const rendered = beats.map((x) =>
        typeof x === "string" ? x : beatTex(x.tokens.map((t) => `${t.head}${t.effects.length ? `{${t.effects.join(" ")}}` : ""}`), x.beat, x.props),
      );
      bars.push(`${meta.join(" ")}${meta.length ? " " : ""}${rendered.join(" ")}`);
      barIndex++;
    });
  });

  const perc = hasPercussion ? `\n\\track "Percussion"\n\\instrument percussion\n\\articulation defaults\n${percBars.join(" |\n")}` : "";
  return { tex: `${header.join("\n")}\n${bars.join(" |\n")}${perc}`, beatRefs };
}

/** Bar index (0-based, across the whole song) of every chord id. */
export function chordBarIndex(song: Song): Map<string, number> {
  const map = new Map<string, number>();
  let i = 0;
  for (const s of song.sections) for (const b of s.bars) {
    for (const c of b.chords) map.set(c.id, i);
    i++;
  }
  return map;
}
