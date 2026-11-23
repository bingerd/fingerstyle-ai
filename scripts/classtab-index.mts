/** Rebuild data/classtab/index.json from already extracted files. */
import { buildIndex } from "../lib/classtab";
const entries = await buildIndex();
console.log(`Indexed ${entries.length} pieces (${entries.filter((e) => e.hasMidi).length} with MIDI).`);
