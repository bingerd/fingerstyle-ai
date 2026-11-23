import { z } from "zod";
import { Song } from "@/lib/ir/schema";
import { normalizeSong } from "@/lib/ir/normalize";
import { ARRANGE_SYSTEM, arrangePrompt } from "@/lib/claude/prompts";
import { GenerationError, generateValidated } from "@/lib/claude/generate";
import { PROVIDERS, type ProviderId } from "@/lib/llm/providers";
import { Tune } from "@/lib/tune/tune";
import { validateAgainstTune, validateSong } from "@/lib/theory/validate";
import {
  ArrangementPlan, Controls, Direction, PLAN_SYSTEM, directionFromControls, lockDirection, needsPlan, planPrompt, validatePlan,
} from "@/lib/arrange/plan";
import { reviewSong } from "@/lib/eval/review";
import { saveSong } from "@/lib/library";
import { startJob } from "@/lib/jobs";

const Body = Controls.extend({
  existing: z.unknown().optional(),
  tune: Tune.refine((t) => t.bars.length > 0 && t.bars.length <= 32, "tune must have 1–32 bars").optional(),
  provider: z.enum(PROVIDERS).default("claude"),
  /** Re-run one specific direction (regenerate) instead of planning new ones. */
  direction: Direction.optional(),
  /** Store every generated arrangement in the library (the eval runner turns this off). */
  autosave: z.boolean().default(true),
  /** Return a job id immediately and run in the background (the UI polls /api/jobs/:id). */
  background: z.boolean().default(false),
});
type Body = z.infer<typeof Body>;

async function arrangeOne(opts: {
  provider: ProviderId; request: string; texture: "comping" | "fingerstyle"; position: string;
  direction: Direction; tune?: Tune; existing?: Song;
}) {
  const { tune, texture, direction } = opts;
  const result = await generateValidated({
    provider: opts.provider,
    schema: Song,
    system: ARRANGE_SYSTEM,
    prompt: arrangePrompt(opts),
    validate: (song) => [
      ...validateSong(song),
      ...(song.texture !== texture ? [{ level: "error" as const, where: "song", message: `texture must be "${texture}"` }] : []),
      ...(tune ? validateAgainstTune(song, tune, undefined, direction.fidelity) : []),
    ],
    effort: tune || texture === "fingerstyle" ? "high" : "medium",
  });
  const song = result.value;
  return { direction, song, warnings: result.warnings, repairs: result.repairs, review: reviewSong(song, { tune, prefs: direction }) };
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request body" }, { status: 400 });
  let existing: Song | undefined;
  try {
    existing = parsed.data.existing ? normalizeSong(parsed.data.existing) : undefined;
  } catch {
    return Response.json({ error: "Invalid existing song" }, { status: 400 });
  }
  const data = parsed.data;
  if (data.background) {
    const label = existing ? `Revising “${existing.title}”` : data.tune ? `Arranging “${data.tune.title}”` : `Arranging “${(data.request || data.style).slice(0, 60)}”`;
    const job = startJob(label, (stage) => runArrange(data, existing, stage));
    return Response.json({ jobId: job.id }, { status: 202 });
  }
  try {
    return Response.json(await runArrange(data, existing, () => {}));
  } catch (e) {
    if (e instanceof GenerationError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Unexpected server error" }, { status: 500 });
  }
}

async function runArrange(data: Body, existing: Song | undefined, stage: (s: string) => void) {
  const { tune, provider, request, position } = data;
  // An imported tune is always arranged with explicit tab so the melody can be checked.
  const texture = tune ? "fingerstyle" : data.texture;
  const controls = { ...data, texture } as Controls;

  // 1. Decide the direction(s): from the user's controls, or planned from the song itself.
  let analysis: ArrangementPlan["analysis"] | null = null;
  let directions: Direction[];
  if (data.direction) directions = [lockDirection(data.direction, controls)];
  else if (existing || !needsPlan(controls)) directions = [directionFromControls(controls)];
  else {
    const want = controls.alternatives;
    stage("Studying the song and planning directions…");
    const plan = await generateValidated({
      provider, schema: ArrangementPlan, system: PLAN_SYSTEM, prompt: planPrompt(controls, want, tune),
      validate: (p) => validatePlan(p, want), effort: "medium",
    });
    analysis = plan.value.analysis;
    directions = plan.value.directions.slice(0, want).map((d) => lockDirection(d, controls));
  }

  // 2. Write every direction in parallel; 3. review and rank them.
  let done = 0;
  const writing = () => stage(directions.length > 1
    ? `Writing ${directions.length} arrangements in parallel (${done} done): ${directions.map((d) => d.name).join(", ")}`
    : `Writing “${directions[0].name}”…`);
  writing();
  const settled = await Promise.allSettled(
    directions.map((direction) =>
      arrangeOne({ provider, request, texture, position, direction, tune, existing }).finally(() => { done++; writing(); }),
    ),
  );
  stage("Reviewing and ranking…");
  const ranked = settled
    .flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))
    .sort((a, b) => b.review.overall - a.review.overall);
  const candidates = await Promise.all(ranked.map(async (c, i) => ({
    id: `${Date.now().toString(36)}-${i}`,
    ...c,
    savedId: data.autosave ? (await saveSong(c.song, undefined, tune, c.direction)).id : null,
  })));
  const failed = settled.flatMap((r, i) =>
    r.status === "rejected" ? [{ direction: directions[i], error: (r.reason as Error)?.message ?? "failed" }] : [],
  );
  if (!candidates.length) {
    const reason = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw reason?.reason ?? new Error("No arrangement produced");
  }
  const best = candidates[0];
  // Top-level song/warnings/repairs keep older clients (and eval/run.mts) working.
  return { analysis, candidates, failed, song: best.song, warnings: best.warnings, repairs: best.repairs };
}
