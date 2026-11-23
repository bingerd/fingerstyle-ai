import type { ChordEvent, Song, TabBeat } from "./schema";

export type ChordLocation = { sectionIndex: number; barIndex: number; chordIndex: number; chord: ChordEvent };

export function findChord(song: Song, id: string): ChordLocation | null {
  for (const [sectionIndex, s] of song.sections.entries())
    for (const [barIndex, b] of s.bars.entries())
      for (const [chordIndex, chord] of b.chords.entries())
        if (chord.id === id) return { sectionIndex, barIndex, chordIndex, chord };
  return null;
}

/** Neighbouring chords (for reharm context). */
export function neighbours(song: Song, id: string): { prev?: ChordEvent; next?: ChordEvent } {
  const flat = song.sections.flatMap((s) => s.bars.flatMap((b) => b.chords));
  const i = flat.findIndex((c) => c.id === id);
  return { prev: flat[i - 1], next: flat[i + 1] };
}

/**
 * Return a new song with chord `id` replaced by `replacement` (ids made unique).
 * For fingerstyle songs, `beats` replaces the explicit tab of the bar that held the chord.
 */
export function replaceChord(song: Song, id: string, replacement: ChordEvent[], beats: TabBeat[] = []): Song {
  const used = new Set(song.sections.flatMap((s) => s.bars.flatMap((b) => b.chords.map((c) => c.id))));
  used.delete(id);
  let n = used.size + 1;
  const fresh = replacement.map((c, i) => {
    let newId = i === 0 && !used.has(id) ? id : c.id;
    while (used.has(newId)) newId = `c${n++}`;
    used.add(newId);
    return { ...c, id: newId };
  });
  return {
    ...song,
    sections: song.sections.map((s) => ({
      ...s,
      bars: s.bars.map((b) =>
        b.chords.some((c) => c.id === id)
          ? { ...b, chords: b.chords.flatMap((c) => (c.id === id ? fresh : [c])), beats: beats.length ? beats : b.beats }
          : b,
      ),
    })),
  };
}

export function flatChords(song: Song): ChordEvent[] {
  return song.sections.flatMap((s) => s.bars.flatMap((b) => b.chords));
}
