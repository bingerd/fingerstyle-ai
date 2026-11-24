/**
 * Curate the public showcase: copies chosen library entries into showcase/songs.json (committed,
 * published on GitHub Pages). Only include material you may publish: traditional/public-domain
 * songs and original pieces — never arrangements of copyrighted songs.
 *
 *   npx tsx scripts/showcase-export.mts <library-id> [<library-id> …]
 */
import { writeFileSync } from "node:fs";
import { listSongs } from "../lib/library";

const ids = process.argv.slice(2);
if (!ids.length) {
  for (const s of await listSongs()) console.log(s.id, "|", s.song.title, "|", s.direction?.name ?? s.song.style);
  console.log("\nPass the ids to publish.");
  process.exit(0);
}
const all = await listSongs();
const chosen = ids.map((id) => {
  const s = all.find((x) => x.id === id);
  if (!s) throw new Error(`no library entry ${id}`);
  const slug = s.song.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return { slug, song: s.song, tune: s.tune, direction: s.direction };
});
writeFileSync("showcase/songs.json", JSON.stringify(chosen));
console.log(`Wrote ${chosen.length} pieces to showcase/songs.json`);
