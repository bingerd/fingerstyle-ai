import type { Tune } from "../lib/tune/tune";

/**
 * Public-domain reference melodies (ground truth for the eval).
 * Compact notation: bars separated by "|", notes as NOTE:beats, "r" for rests.
 */
const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midi(n: string): number {
  const m = /^([A-G])(#|b)?(\d)$/.exec(n);
  if (!m) throw new Error(`bad note ${n}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

function tune(title: string, tempo: number, ts: [number, number], text: string): Tune {
  const bars = text.split("|").map((bar) => {
    let pos = 0;
    const melody = bar.trim().split(/\s+/).flatMap((tok) => {
      const [n, d] = tok.split(":");
      const dur = Number(d);
      const start = pos;
      pos += dur;
      return n === "r" ? [] : [{ start, dur, midi: midi(n) }];
    });
    const len = ts[0] * (4 / ts[1]);
    if (Math.abs(pos - len) > 1e-6) throw new Error(`${title}: bar "${bar.trim()}" has ${pos} beats`);
    return { melody, chords: [], accompaniment: [], bass: [] };
  });
  return { title, tempo, timeSignature: { numerator: ts[0], denominator: ts[1] }, bars };
}

export const EVAL_TUNES: { name: string; tune: Tune }[] = [
  {
    name: "Ode to Joy (Beethoven)",
    tune: tune("Ode to Joy", 96, [4, 4],
      "E4:1 E4:1 F4:1 G4:1 | G4:1 F4:1 E4:1 D4:1 | C4:1 C4:1 D4:1 E4:1 | E4:1.5 D4:0.5 D4:2 | " +
      "E4:1 E4:1 F4:1 G4:1 | G4:1 F4:1 E4:1 D4:1 | C4:1 C4:1 D4:1 E4:1 | D4:1.5 C4:0.5 C4:2"),
  },
  {
    name: "Twinkle Twinkle Little Star",
    tune: tune("Twinkle Twinkle Little Star", 100, [4, 4],
      "C4:1 C4:1 G4:1 G4:1 | A4:1 A4:1 G4:2 | F4:1 F4:1 E4:1 E4:1 | D4:1 D4:1 C4:2 | " +
      "G4:1 G4:1 F4:1 F4:1 | E4:1 E4:1 D4:2 | G4:1 G4:1 F4:1 F4:1 | E4:1 E4:1 D4:2"),
  },
  {
    name: "Mary Had a Little Lamb",
    tune: tune("Mary Had a Little Lamb", 110, [4, 4],
      "E4:1 D4:1 C4:1 D4:1 | E4:1 E4:1 E4:2 | D4:1 D4:1 D4:2 | E4:1 G4:1 G4:2 | " +
      "E4:1 D4:1 C4:1 D4:1 | E4:1 E4:1 E4:1 E4:1 | D4:1 D4:1 E4:1 D4:1 | C4:4"),
  },
  {
    name: "Frère Jacques",
    tune: tune("Frère Jacques", 100, [4, 4],
      "C4:1 D4:1 E4:1 C4:1 | C4:1 D4:1 E4:1 C4:1 | E4:1 F4:1 G4:2 | E4:1 F4:1 G4:2 | " +
      "G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:1 C4:1 | G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:1 C4:1 | C4:1 G3:1 C4:2 | C4:1 G3:1 C4:2"),
  },
  {
    name: "Jingle Bells (chorus)",
    tune: tune("Jingle Bells", 120, [4, 4],
      "E4:1 E4:1 E4:2 | E4:1 E4:1 E4:2 | E4:1 G4:1 C4:1.5 D4:0.5 | E4:4 | " +
      "F4:1 F4:1 F4:1 F4:1 | F4:1 E4:1 E4:1 E4:0.5 E4:0.5 | E4:1 D4:1 D4:1 E4:1 | D4:2 G4:2"),
  },
];
