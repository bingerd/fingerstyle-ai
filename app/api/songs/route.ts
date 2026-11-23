import { listSongs, saveSong } from "@/lib/library";

export async function GET() {
  return Response.json({ songs: await listSongs() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  try {
    return Response.json(await saveSong(body?.song, body?.id, body?.tune, body?.direction));
  } catch {
    return Response.json({ error: "Invalid song" }, { status: 400 });
  }
}
