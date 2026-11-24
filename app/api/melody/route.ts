import { z } from "zod";
import { GenerationError, generateValidated } from "@/lib/claude/generate";
import { PROVIDERS } from "@/lib/llm/providers";
import { MelodyRecall, RECALL_SYSTEM, recallPrompt, recallToTune, validateRecall } from "@/lib/tune/recall";

const Body = z.object({
  request: z.string().min(1).max(500),
  bars: z.number().int().min(4).max(32).default(16),
  hint: z.string().max(500).optional(),
  provider: z.enum(PROVIDERS).default("claude"),
});

/** Recall a named song's melody so the player can confirm it by ear before arranging. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request body" }, { status: 400 });
  const { request, bars, hint, provider } = parsed.data;
  try {
    const r = await generateValidated({
      provider, schema: MelodyRecall, system: RECALL_SYSTEM, prompt: recallPrompt(request, bars, hint),
      validate: validateRecall, effort: "medium", maxRepairs: 1,
    });
    return Response.json({ tune: recallToTune(r.value), confidence: r.value.confidence, doubts: r.value.doubts });
  } catch (e) {
    if (e instanceof GenerationError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
