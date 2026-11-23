import { classTabMidi, classTabText } from "@/lib/classtab";

export async function GET(req: Request, ctx: RouteContext<"/api/classtab/[id]">) {
  const { id } = await ctx.params;
  if (new URL(req.url).searchParams.get("format") === "midi") {
    const midi = await classTabMidi(id);
    if (!midi) return Response.json({ error: "No MIDI for this piece" }, { status: 404 });
    return new Response(new Uint8Array(midi), { headers: { "Content-Type": "audio/midi" } });
  }
  const found = await classTabText(id);
  if (!found) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(found);
}
