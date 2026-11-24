import { z } from "zod";
import type { Issue } from "@/lib/theory/validate";
import type { Tune } from "./tune";

/** The model's recollection of a song's melody, checked for well-formedness before anyone hears it. */
export const MelodyRecall = z.object({
  title: z.string(),
  tempo: z.number().int(),
  timeSignature: z.object({ numerator: z.number().int(), denominator: z.number().int() }),
  confidence: z.enum(["high", "medium", "low"]),
  /** Which phrases it is unsure about, in plain words. */
  doubts: z.string(),
  bars: z.array(z.object({ melody: z.array(z.object({ start: z.number(), dur: z.number(), midi: z.number().int() })) })),
});
export type MelodyRecall = z.infer<typeof MelodyRecall>;

export const RECALL_SYSTEM = `You are a musician with a precise ear and memory for melodies. Write down the MAIN MELODY (the sung or lead line, the hook people hum) of the requested song as notes, from memory.
- Start at the most recognizable part (usually the chorus/hook) unless the player asks for another part.
- Notes: start and dur in quarter-note beats from the start of each bar, midi pitch numbers (middle C = 60), monophonic, sorted, inside the bar.
- Use the song's real key, meter and tempo if you know them.
- Be honest: confidence "high" only if you are sure of the pitches AND rhythm; list doubtful phrases in doubts. Never pad with invented material: if you don't know the melody, return confidence "low" and as much as you are sure of.
- No lyrics.`;

export function recallPrompt(request: string, bars: number, hint?: string): string {
  return [`Song: ${request}`, `Write ${bars} bars of its melody.`, hint ? `The player listened to your previous attempt and says: ${hint}` : ""].filter(Boolean).join("\n");
}

export function validateRecall(r: MelodyRecall): Issue[] {
  const issues: Issue[] = [];
  const perBar = r.timeSignature.numerator * (4 / r.timeSignature.denominator);
  if (![2, 4, 8].includes(r.timeSignature.denominator)) issues.push({ level: "error", where: "timeSignature", message: "denominator must be 2, 4 or 8" });
  if (r.bars.length < 2 || r.bars.length > 32) issues.push({ level: "error", where: "bars", message: "write 2–32 bars" });
  r.bars.forEach((b, i) => {
    let end = 0;
    for (const n of [...b.melody].sort((x, y) => x.start - y.start)) {
      const where = `bar ${i + 1} at beat ${n.start + 1}`;
      if (n.start < end - 1e-6) issues.push({ level: "error", where, message: "notes overlap (the melody is one voice)" });
      if (n.dur <= 0 || n.start < 0 || n.start + n.dur > perBar + 1e-6) issues.push({ level: "error", where, message: `note must fit inside the ${perBar}-beat bar` });
      if (n.midi < 40 || n.midi > 96) issues.push({ level: "error", where, message: `pitch ${n.midi} is out of range` });
      end = n.start + n.dur;
    }
  });
  if (!r.bars.some((b) => b.melody.length)) issues.push({ level: "error", where: "bars", message: "no notes" });
  return issues;
}

export function recallToTune(r: MelodyRecall): Tune {
  return {
    title: r.title,
    tempo: r.tempo,
    timeSignature: r.timeSignature,
    source: "memory",
    bars: r.bars.map((b) => ({ melody: [...b.melody].sort((x, y) => x.start - y.start), chords: [], accompaniment: [], bass: [] })),
  };
}
