import { getJob } from "@/lib/jobs";

export async function GET(_req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const job = getJob((await ctx.params).id);
  if (!job) return Response.json({ error: "Job not found (the server may have restarted). Finished arrangements are in your library." }, { status: 404 });
  return Response.json(job);
}
