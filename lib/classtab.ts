import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local copy of the ClassTab.org catalogue (classical guitar tabs + MIDI), stored in data/classtab
 * (git-ignored: the content belongs to ClassTab and its transcribers). Refresh with `npm run classtab:update`.
 */
export const CLASSTAB_DIR = path.join(process.cwd(), "data", "classtab");
const FILES = path.join(CLASSTAB_DIR, "extracted", "classtab");
const INDEX = path.join(CLASSTAB_DIR, "index.json");

export type ClassTabEntry = {
  id: string;
  title: string;
  composer: string;
  tuning: string;
  time: string;
  hasMidi: boolean;
  unchecked: boolean;
};

const ID_RE = /^[\w.'\- ,()&+]+$/;

/** Text files are a mix of UTF-8 and Latin-1. */
function decode(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return buf.toString("latin1");
  }
}

const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function parseEntry(id: string, text: string, hasMidi: boolean): ClassTabEntry {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const first = lines.find((l) => l && !/^[-|=]+$/.test(l)) ?? id;
  const field = (name: string) => lines.find((l) => new RegExp(`^${name}\\s*[-:=]`, "i").test(l))?.replace(new RegExp(`^${name}\\s*[-:=]\\s*`, "i"), "") ?? "";
  return {
    id,
    title: first.slice(0, 160),
    composer: titleCase(id.split("_")[0]),
    tuning: field("tuning").slice(0, 40),
    time: field("time").slice(0, 20),
    hasMidi,
    unchecked: /unchecked/i.test(id),
  };
}

export async function buildIndex(): Promise<ClassTabEntry[]> {
  const names = await readdir(FILES);
  const mids = new Set(names.filter((n) => n.toLowerCase().endsWith(".mid")).map((n) => n.slice(0, -4)));
  const entries: ClassTabEntry[] = [];
  for (const n of names.filter((n) => n.toLowerCase().endsWith(".txt"))) {
    const id = n.slice(0, -4);
    if (id.startsWith("0_") || !ID_RE.test(id)) continue;
    const text = decode(await readFile(path.join(FILES, n)));
    entries.push(parseEntry(id, text, mids.has(id)));
  }
  entries.sort((a, b) => a.composer.localeCompare(b.composer) || a.id.localeCompare(b.id));
  await writeFile(INDEX, JSON.stringify(entries));
  return entries;
}

let cache: ClassTabEntry[] | null = null;

/** The catalogue, or null when ClassTab hasn't been downloaded yet. */
export async function classTabIndex(): Promise<ClassTabEntry[] | null> {
  if (cache) return cache;
  if (existsSync(INDEX)) cache = JSON.parse(await readFile(INDEX, "utf8")) as ClassTabEntry[];
  else if (existsSync(FILES)) cache = await buildIndex();
  return cache;
}

/** Resolve an id only if it is in the index, so request input never builds an arbitrary path. */
async function known(id: string): Promise<ClassTabEntry | null> {
  const index = await classTabIndex();
  return index?.find((e) => e.id === id) ?? null;
}

export async function classTabText(id: string): Promise<{ entry: ClassTabEntry; text: string } | null> {
  const entry = await known(id);
  if (!entry) return null;
  return { entry, text: decode(await readFile(path.join(FILES, `${entry.id}.txt`))) };
}

export async function classTabMidi(id: string): Promise<Buffer | null> {
  const entry = await known(id);
  if (!entry?.hasMidi) return null;
  return readFile(path.join(FILES, `${entry.id}.mid`));
}
