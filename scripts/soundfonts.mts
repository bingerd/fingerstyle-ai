/**
 * Download the FreePats recorded guitars and install them next to alphaTab:
 *   npm run soundfonts:guitar
 * - Spanish Classical Guitar (nylon), CC0 — https://freepats.zenvoid.org/Guitar/acoustic-guitar.html
 * - FSS Steel-String Acoustic Guitar, GPL-3.0+ with FreePats exception — https://freepats.zenvoid.org/Guitar/steel-acoustic-guitar.html
 * Both ship as preset 0; we renumber them to spare GM programs (105/106) so they can sit on top of the
 * main soundfont without replacing anything, and the Sound menu can switch between them.
 * Output files are git-ignored.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const DL = path.join("data", "soundfonts", "dl");
const X = path.join("data", "soundfonts", "x");
const OUT = path.join("public", "alphatab");
const FONTS = [
  { url: "https://freepats.zenvoid.org/Guitar/SpanishClassicalGuitar/SpanishClassicalGuitar-SF2-20190618.7z", out: "freepats-nylon.sf2", program: 105 },
  { url: "https://freepats.zenvoid.org/Guitar/FSS-SteelStringGuitar/FSS-SteelStringGuitar-SF2-20200521.tar.xz", out: "freepats-steel.sf2", program: 106 },
];

/** Set every preset (except the EOP terminator) in an SF2's phdr chunk to bank 0 / `program`. */
export function renumber(sf2: Buffer, program: number): Buffer {
  const pdta = sf2.indexOf("pdta");
  const phdr = sf2.indexOf("phdr", pdta);
  if (pdta < 0 || phdr < 0) throw new Error("not an SF2 file");
  const len = sf2.readUInt32LE(phdr + 4);
  for (let o = phdr + 8; o + 38 <= phdr + 8 + len - 38; o += 38) {
    sf2.writeUInt16LE(program, o + 20);
    sf2.writeUInt16LE(0, o + 22);
  }
  return sf2;
}

mkdirSync(DL, { recursive: true });
mkdirSync(X, { recursive: true });
for (const f of FONTS) {
  const archive = path.join(DL, path.basename(f.url));
  if (!existsSync(archive)) {
    console.log(`Downloading ${f.url}…`);
    execFileSync("curl", ["-fsSL", "-o", archive, f.url], { stdio: "inherit" });
  }
  const dir = path.join(X, path.basename(f.url).replace(/\.(7z|tar\.xz)$/, ""));
  if (!existsSync(dir)) execFileSync("bsdtar", ["-xf", archive, "-C", X], { stdio: "inherit" });
  const sf2 = readdirSync(dir).find((n) => n.endsWith(".sf2"));
  if (!sf2) throw new Error(`no .sf2 in ${dir}`);
  writeFileSync(path.join(OUT, f.out), renumber(readFileSync(path.join(dir, sf2)), f.program));
  console.log(`Installed ${f.out} as GM program ${f.program}`);
}
