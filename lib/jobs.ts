/**
 * In-memory background jobs for long generations. Kept on globalThis so they survive dev hot reloads;
 * a server restart forgets running jobs (finished arrangements are already in the library).
 */
export type Job = {
  id: string;
  kind: "arrange";
  label: string;
  status: "running" | "done" | "error";
  stage: string;
  startedAt: number;
  finishedAt?: number;
  result?: unknown;
  /** Results that are ready before the whole job finishes (e.g. the first of several arrangements). */
  partial: unknown[];
  error?: string;
  httpStatus?: number;
};

const g = globalThis as unknown as { __jobs?: Map<string, Job> };
const jobs = (g.__jobs ??= new Map<string, Job>());
const KEEP_MS = 6 * 60 * 60_000;

export function startJob(label: string, work: (setStage: (s: string) => void, pushPartial: (x: unknown) => void) => Promise<unknown>): Job {
  for (const [id, j] of jobs) if (j.finishedAt && Date.now() - j.finishedAt > KEEP_MS) jobs.delete(id);
  const job: Job = { id: crypto.randomUUID(), kind: "arrange", label, status: "running", stage: "Starting…", startedAt: Date.now(), partial: [] };
  jobs.set(job.id, job);
  work((s) => { job.stage = s; }, (x) => { job.partial.push(x); })
    .then((result) => Object.assign(job, { status: "done", result, stage: "Done", finishedAt: Date.now() }))
    .catch((e: Error & { status?: number }) =>
      Object.assign(job, { status: "error", error: e.message || "Generation failed", httpStatus: e.status ?? 500, finishedAt: Date.now() }),
    );
  return job;
}

export const getJob = (id: string) => jobs.get(id) ?? null;
export const listJobs = () => [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
