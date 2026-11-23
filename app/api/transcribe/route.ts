import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const WORKER = path.join(process.cwd(), "worker");
const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED = /\.(mp3|wav|m4a|aac|flac|ogg)$/i;

/** Audio file in → MIDI out, via the local basic-pitch worker (worker/transcribe.py, run with uv). */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !ALLOWED.test(file.name)) return Response.json({ error: "Upload an MP3, WAV, M4A, AAC, FLAC or OGG file." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Audio file is larger than 50 MB." }, { status: 413 });

  const dir = await mkdtemp(path.join(os.tmpdir(), "woodshed-audio-"));
  try {
    const src = path.join(dir, `input${path.extname(file.name).toLowerCase()}`);
    const dst = path.join(dir, "out.mid");
    await writeFile(src, new Uint8Array(await file.arrayBuffer()));
    const { code, stderr } = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const uv = [process.env.UV_BIN, path.join(os.homedir(), ".local/bin/uv"), "/opt/homebrew/bin/uv", "uv"].find(Boolean)!;
      const child = spawn(uv, ["run", "--project", WORKER, "python", path.join(WORKER, "transcribe.py"), src, dst], { cwd: WORKER });
      let err = "";
      const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Transcription timed out")); }, 5 * 60_000);
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (c) => { clearTimeout(timer); resolve({ code: c, stderr: err }); });
    });
    if (code !== 0) {
      console.error(stderr);
      return Response.json({ error: "Transcription failed. Run `cd worker && uv sync` to set up the audio worker." }, { status: 500 });
    }
    const midi = await readFile(dst);
    return new Response(new Uint8Array(midi), { headers: { "Content-Type": "audio/midi" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
