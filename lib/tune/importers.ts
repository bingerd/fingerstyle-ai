import { Midi } from "@tonejs/midi";
import type * as AlphaTabNS from "@coderline/alphatab";
import type { RawScore } from "./tune";

/** Parse a Standard MIDI File. */
export function rawFromMidi(bytes: Uint8Array, fallbackTitle: string): RawScore {
  const midi = new Midi(bytes);
  const ts = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  return {
    title: midi.name || fallbackTitle,
    tempo: midi.header.tempos[0]?.bpm ?? 120,
    ppq: midi.header.ppq,
    timeSignature: { numerator: ts[0], denominator: ts[1] },
    tracks: midi.tracks.map((t, i) => ({
      name: t.instrument.percussion ? `Drums ${i + 1}` : t.name || t.instrument.name || `Track ${i + 1}`,
      notes: t.notes.map((n) => ({ tick: n.ticks, durTicks: n.durationTicks, midi: n.midi })),
    })),
  };
}

/** Convert a score loaded by alphaTab (Guitar Pro, MusicXML, …) into the neutral raw format. */
export function rawFromAlphaTab(score: AlphaTabNS.model.Score, fallbackTitle: string): RawScore {
  const ppq = 960; // alphaTab's MIDI resolution (ticks per quarter)
  const first = score.masterBars[0];
  const chords: { tick: number; name: string }[] = [];
  const tracks = score.tracks.map((track) => {
    const notes: RawScore["tracks"][number]["notes"] = [];
    for (const staff of track.staves) {
      if (staff.isPercussion) continue;
      for (const bar of staff.bars) {
        const barStart = bar.masterBar.start;
        for (const voice of bar.voices)
          for (const beat of voice.beats) {
            if (beat.chord?.name && voice.index === 0) chords.push({ tick: barStart + beat.playbackStart, name: beat.chord.name });
            if (beat.isRest) continue;
            for (const n of beat.notes) {
              if (n.isTieDestination) continue;
              notes.push({ tick: barStart + beat.playbackStart, durTicks: beat.playbackDuration, midi: n.realValue });
            }
          }
      }
    }
    return { name: track.name || "Track", notes };
  });
  return {
    title: score.title || fallbackTitle,
    tempo: score.tempo || 120,
    ppq,
    timeSignature: { numerator: first?.timeSignatureNumerator ?? 4, denominator: first?.timeSignatureDenominator ?? 4 },
    tracks,
    chords,
  };
}
