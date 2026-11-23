import { z } from "zod";
import { ReharmResponse, type Song } from "@/lib/ir/schema";
import { REHARM_SYSTEM, reharmPrompt } from "@/lib/claude/prompts";
import { GenerationError, generateValidated } from "@/lib/claude/generate";
import { PROVIDERS } from "@/lib/llm/providers";
import { findChord } from "@/lib/ir/edit";
import { barBeats, rhythmBeats, validateAgainstTune, validateBeats, validateChord, type Issue } from "@/lib/theory/validate";
import { normalizeSong } from "@/lib/ir/normalize";
import { replaceChord } from "@/lib/ir/edit";
import { Tune } from "@/lib/tune/tune";
import { FIDELITIES } from "@/lib/arrange/plan";

const Body = z.object({ song: z.unknown(), tune: Tune.optional(), targetId: z.string(), instruction: z.string().max(500).optional(), provider: z.enum(PROVIDERS).default("claude"), fidelity: z.enum(FIDELITIES).default("exact") });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request body" }, { status: 400 });
  const { targetId, instruction, provider, tune, fidelity } = parsed.data;
  let song: Song;
  try {
    song = normalizeSong(parsed.data.song);
  } catch {
    return Response.json({ error: "Invalid song" }, { status: 400 });
  }
  const target = findChord(song, targetId);
  if (!target) return Response.json({ error: "Chord not found" }, { status: 404 });
  const slotBeats = rhythmBeats(target.chord.rhythm);

  const validate = (r: ReharmResponse): Issue[] =>
    r.options.flatMap((opt, oi) => {
      const where = `option ${oi + 1} (${opt.technique})`;
      const issues: Issue[] = opt.chords.flatMap((c) => validateChord(c, `${where} ${c.symbol}`));
      const total = opt.chords.reduce((n, c) => n + rhythmBeats(c.rhythm), 0);
      if (!opt.chords.length) issues.push({ level: "error", where, message: "no chords" });
      if (Math.abs(total - slotBeats) > 1e-6)
        issues.push({ level: "error", where, message: `rhythms add up to ${total} beats, slot needs ${slotBeats}` });
      if (song.texture === "fingerstyle") {
        if (!opt.beats.length) issues.push({ level: "error", where, message: "fingerstyle song: beats (the rewritten bar) are required" });
        else {
          const bar = song.sections[target.sectionIndex].bars[target.barIndex];
          const symbols = [...bar.chords.filter((c) => c.id !== targetId), ...opt.chords].map((c) => c.symbol);
          issues.push(...validateBeats(opt.beats, barBeats(song.timeSignature), symbols, where));
          if (tune) {
            const barIdx = song.sections.slice(0, target.sectionIndex).reduce((n, s) => n + s.bars.length, 0) + target.barIndex;
            const next = replaceChord(song, targetId, opt.chords, opt.beats);
            issues.push(...validateAgainstTune(next, tune, barIdx, fidelity).map((i) => ({ ...i, where: `${where}: ${i.where}` })));
          }
        }
      }
      return issues;
    });

  try {
    const result = await generateValidated({
      provider,
      schema: ReharmResponse,
      system: REHARM_SYSTEM,
      prompt: reharmPrompt({ song, targetId, slotBeats, instruction }),
      validate,
      effort: "low",
    });
    return Response.json({ options: result.value.options, warnings: result.warnings });
  } catch (e) {
    if (e instanceof GenerationError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
