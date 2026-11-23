import { deleteSong } from "@/lib/library";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/songs/[id]">) {
  const { id } = await ctx.params;
  return (await deleteSong(id)) ? new Response(null, { status: 204 }) : Response.json({ error: "Bad id" }, { status: 400 });
}
