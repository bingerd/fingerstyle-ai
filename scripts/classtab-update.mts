/**
 * Download (or refresh) the ClassTab.org catalogue into data/classtab and rebuild the index.
 * ClassTab updates its zip monthly:  npm run classtab:update
 * The files stay local (data/ is git-ignored); they belong to ClassTab and its transcribers.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { CLASSTAB_DIR, buildIndex } from "../lib/classtab";

const zip = path.join(CLASSTAB_DIR, "download", "classtab.zip");
const out = path.join(CLASSTAB_DIR, "extracted");
mkdirSync(path.dirname(zip), { recursive: true });
console.log("Downloading https://www.classtab.org/zip/classtab.zip (~14 MB)…");
execFileSync("curl", ["-fsSL", "-o", zip, "https://www.classtab.org/zip/classtab.zip"], { stdio: "inherit" });
rmSync(out, { recursive: true, force: true });
execFileSync("unzip", ["-q", "-o", zip, "-d", out], { stdio: "inherit" });
const entries = await buildIndex();
console.log(`Indexed ${entries.length} pieces (${entries.filter((e) => e.hasMidi).length} with MIDI).`);
