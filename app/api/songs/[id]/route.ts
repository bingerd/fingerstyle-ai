import { deleteSong, setProgress } from "@/lib/library";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/songs/[id]">) {
  const { id } = await ctx.params;
  return (await deleteSong(id)) ? new Response(null, { status: 204 }) : Response.json({ error: "Bad id" }, { status: 400 });
}

/** Update practice progress: { mastered: string[] }. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/songs/[id]">) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.mastered) || !body.mastered.every((m: unknown) => typeof m === "string"))
    return Response.json({ error: "Invalid progress" }, { status: 400 });
  return (await setProgress(id, body.mastered)) ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
}
