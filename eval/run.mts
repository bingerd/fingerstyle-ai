/**
 * Quality eval: arranges public-domain tunes through the running app and scores the results.
 *
 *   npx tsx eval/run.mts [--providers claude,codex] [--modes name,import] [--tunes ode,twinkle]
 *                        [--presets "Fingerstyle folk:clean;Percussive pop fingerstyle:showstopper"] [--concurrency 3]
 *
 * Modes:
 *   name   — "Arrange <tune> as fingerstyle" with no file: tests whether the model knows the song.
 *   import — the tune is imported (ground truth melody): tests fidelity, repairs and playability.
 * Every arrangement is also scored against the *other* tunes, which gives the chance level
 * of the melody metric (what a wrong song scores).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EVAL_TUNES } from "./tunes";
import { flair, melodyScore, playability, type Flair, type MelodyScore, type Playability } from "../lib/eval/metrics";
import type { Song } from "../lib/ir/schema";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const BASE = arg("base", "http://localhost:3210");
const PROVIDERS = arg("providers", "claude,codex").split(",");
const MODES = arg("modes", "name,import").split(",") as ("name" | "import")[];
const CONCURRENCY = Number(arg("concurrency", "3"));
const TUNE_FILTER = arg("tunes", "");
/** Style presets to compare, as "Style name:flair" pairs separated by ";". */
const PRESETS = arg("presets", "Fingerstyle folk:clean").split(";").map((p) => {
  const [style, fl] = p.split(":");
  return { style, flair: (fl || "expressive") as "clean" | "expressive" | "showstopper" };
});

type Job = { tune: (typeof EVAL_TUNES)[number]; provider: string; mode: "name" | "import"; preset: (typeof PRESETS)[number] };
type Result = Job & {
  ok: boolean;
  error?: string;
  seconds: number;
  repairs?: number;
  warnings?: number;
  melody?: MelodyScore;
  chance?: number;
  play?: Playability;
  flair?: Flair;
  song?: Song;
};

async function runJob(job: Job): Promise<Result> {
  const t0 = Date.now();
  const body =
    job.mode === "name"
      ? {
          request: `Arrange the melody of "${job.tune.name}" as a fingerstyle guitar piece with the melody on top. Only the first ${job.tune.tune.bars.length} bars of the melody, starting on bar 1 with no intro.`,
          style: job.preset.style, flair: job.preset.flair, difficulty: "intermediate", position: "No preference", texture: "fingerstyle", provider: job.provider, autosave: false,
        }
      : {
          request: "", style: job.preset.style, flair: job.preset.flair, difficulty: "intermediate", position: "No preference", texture: "fingerstyle",
          tune: job.tune.tune, provider: job.provider, autosave: false,
        };
  try {
    const res = await fetch(`${BASE}/api/arrange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    const seconds = (Date.now() - t0) / 1000;
    if (!res.ok) return { ...job, ok: false, error: data.error, seconds };
    const song: Song = data.song;
    const others = EVAL_TUNES.filter((t) => t !== job.tune).map((t) => melodyScore(song, t.tune).exact);
    return {
      ...job, ok: true, seconds, song,
      repairs: data.repairs,
      warnings: data.warnings.length,
      melody: melodyScore(song, job.tune.tune),
      chance: others.reduce((a, b) => a + b, 0) / others.length,
      play: playability(song),
      flair: flair(song),
    };
  } catch (e) {
    return { ...job, ok: false, error: (e as Error).message, seconds: (Date.now() - t0) / 1000 };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      const r = out[i] as unknown as Result;
      console.log(`${r.ok ? "✓" : "✗"} ${r.preset.flair.padEnd(11)} ${r.provider.padEnd(6)} ${r.mode.padEnd(6)} ${r.tune.name.padEnd(28)} ${r.seconds.toFixed(0)}s ${r.ok ? `melody ${(r.melody!.exact * 100).toFixed(0)}%` : r.error}`);
    }
  }));
  return out;
}

const pct = (x?: number) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function report(results: Result[]): string {
  const lines = [`# Fingerstyle AI quality eval — ${new Date().toISOString()}`, ""];
  lines.push("## Summary", "", "| Preset | Provider | Mode | OK | Melody exact | Chance | Repairs | Max span | Mean shift | Techniques/bar | Percussion/bar | Syncopation | Rhythm values | Bass notes/bar | Tunings | Time |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const pr of PRESETS)
    for (const p of PROVIDERS)
      for (const m of MODES) {
        const rs = results.filter((r) => r.provider === p && r.mode === m && r.preset === pr);
        const ok = rs.filter((r) => r.ok);
        const f = (k: keyof Flair) => avg(ok.map((r) => r.flair![k] as number)).toFixed(1);
        lines.push(`| ${pr.style} / ${pr.flair} | ${p} | ${m} | ${ok.length}/${rs.length} | ${pct(avg(ok.map((r) => r.melody!.exact)))} | ${pct(avg(ok.map((r) => r.chance!)))} | ${avg(ok.map((r) => r.repairs!)).toFixed(1)} | ${Math.max(0, ...ok.map((r) => r.play!.maxSpan))} | ${avg(ok.map((r) => r.play!.meanShift)).toFixed(1)} | ${f("techniquesPerBar")} | ${f("percussionPerBar")} | ${pct(avg(ok.map((r) => r.flair!.syncopation)))} | ${f("rhythmicValues")} | ${f("bassMotion")} | ${[...new Set(ok.map((r) => `${r.flair!.tuning}${r.flair!.capo ? `+capo${r.flair!.capo}` : ""}`))].join(", ")} | ${avg(rs.map((r) => r.seconds)).toFixed(0)}s |`);
      }
  lines.push("", "## Per tune", "", "| Tune | Provider | Mode | Melody exact | ±½ beat | Transpose | Bar offset | Bars | Attacks/bar | Top on strings 1–3 | Warnings | Error |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results)
    lines.push(`| ${r.tune.name} | ${r.provider} | ${r.mode} | ${pct(r.melody?.exact)} | ${pct(r.melody?.loose)} | ${r.melody?.transpose ?? "–"} | ${r.melody?.barOffset ?? "–"} | ${r.play?.bars ?? "–"} | ${r.play?.attacksPerBar.toFixed(1) ?? "–"} | ${pct(r.play?.topOnTrebleStrings)} | ${r.warnings ?? "–"} | ${r.error ?? ""} |`);
  return lines.join("\n");
}

const tunes = TUNE_FILTER ? EVAL_TUNES.filter((t) => TUNE_FILTER.split(",").some((f) => t.name.toLowerCase().includes(f.toLowerCase()))) : EVAL_TUNES;
const jobs: Job[] = PRESETS.flatMap((preset) => PROVIDERS.flatMap((provider) => MODES.flatMap((mode) => tunes.map((tune) => ({ tune, provider, mode, preset })))));
console.log(`Running ${jobs.length} arrangements (concurrency ${CONCURRENCY}) against ${BASE}…`);
const results = await pool(jobs, CONCURRENCY, runJob);
const dir = path.join(import.meta.dirname, "results");
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify(results, null, 1));
const md = report(results);
writeFileSync(path.join(dir, `${stamp}.md`), md);
console.log("\n" + md);
