import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Song, type SavedSong } from "@/lib/ir/schema";
import { normalizeSong } from "@/lib/ir/normalize";
import { Tune } from "@/lib/tune/tune";
import { Direction } from "@/lib/arrange/plan";

/** Local, file-based song library: one JSON file per song in data/songs. */
const DIR = path.join(process.cwd(), "data", "songs");
const safeId = (id: string) => /^[a-z0-9-]{1,64}$/.test(id);

export async function listSongs(): Promise<SavedSong[]> {
  await mkdir(DIR, { recursive: true });
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json"));
  const songs = await Promise.all(
    files.map(async (f) => {
      const entry = JSON.parse(await readFile(path.join(DIR, f), "utf8")) as SavedSong;
      return { ...entry, song: normalizeSong(entry.song) };
    }),
  );
  return songs.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function saveSong(song: Song, id?: string, tune?: unknown, direction?: unknown): Promise<SavedSong> {
  const parsed = Song.parse(song);
  const finalId = id && safeId(id) ? id : crypto.randomUUID();
  const parsedTune = tune ? Tune.parse(tune) : undefined;
  const parsedDirection = direction ? Direction.safeParse(direction).data : undefined;
  const previous = await readEntry(finalId);
  const entry: SavedSong = {
    id: finalId, savedAt: new Date().toISOString(), song: parsed,
    ...(parsedTune && { tune: parsedTune }), ...(parsedDirection && { direction: parsedDirection }),
    ...(previous?.progress && { progress: previous.progress }),
  };
  await mkdir(DIR, { recursive: true });
  await writeFile(path.join(DIR, `${finalId}.json`), JSON.stringify(entry, null, 2));
  return entry;
}

async function readEntry(id: string): Promise<SavedSong | null> {
  try {
    return JSON.parse(await readFile(path.join(DIR, `${id}.json`), "utf8")) as SavedSong;
  } catch {
    return null;
  }
}

/** Store practice progress without touching the arrangement. */
export async function setProgress(id: string, mastered: string[]): Promise<boolean> {
  if (!safeId(id)) return false;
  const entry = await readEntry(id);
  if (!entry) return false;
  entry.progress = { mastered: [...new Set(mastered.filter((m) => /^\d+-\d+-[\d.]+$/.test(m)))].slice(0, 500) };
  await writeFile(path.join(DIR, `${id}.json`), JSON.stringify(entry, null, 2));
  return true;
}

export async function deleteSong(id: string): Promise<boolean> {
  if (!safeId(id)) return false;
  await rm(path.join(DIR, `${id}.json`), { force: true });
  return true;
}
