import type * as AlphaTabNS from "@coderline/alphatab";

type AT = typeof AlphaTabNS;

/**
 * Expressive playback: a real fingerstyle player voices the melody over the bass and rolls full
 * chords slightly. alphaTab derives each note's MIDI velocity from note.dynamics, so this changes
 * the sound without adding dynamics marks to the tab. Big chords get a quick roll (arpeggio).
 */
export function humanize(at: AT, score: AlphaTabNS.model.Score) {
  const D = at.model.DynamicValue;
  // Shape the whole piece: the first section a notch softer, the last one a notch louder (the climax).
  const sectionOf: number[] = [];
  let sec = -1;
  for (const mb of score.masterBars) { if (mb.section || sec < 0) sec++; sectionOf.push(sec); }
  const sections = sec + 1;
  const shift = (barIndex: number) => (sections < 2 ? 0 : sectionOf[barIndex] === 0 ? -1 : sectionOf[barIndex] === sections - 1 ? 1 : 0);
  const level = (v: number, barIndex: number) => Math.max(D.PPP, Math.min(D.FFF, v + shift(barIndex))) as AlphaTabNS.model.DynamicValue;
  for (const track of score.tracks)
    for (const staff of track.staves)
      for (const bar of staff.bars)
        for (const voice of bar.voices)
          for (const beat of voice.beats) {
            const notes = beat.notes.filter((n) => !n.isDead && !n.isPercussion);
            if (!notes.length) continue;
            const sorted = [...notes].sort((a, b) => a.realValue - b.realValue);
            const top = sorted.at(-1)!;
            const bottom = sorted[0];
            const downbeat = beat.playbackStart === 0;
            for (const n of notes) {
              if (n === top) n.dynamics = level(downbeat ? D.FF : D.F, bar.index); // melody sings
              else if (n === bottom) n.dynamics = level(D.MF, bar.index); // thumb bass
              else n.dynamics = level(D.P, bar.index); // inner voices stay underneath
            }
            if (notes.length >= 4 && beat.brushType === at.model.BrushType.None) {
              beat.brushType = at.model.BrushType.ArpeggioUp;
              beat.brushDuration = 60;
            }
          }
}

/** Download a Guitar Pro 7 file of the rendered score (opens in Guitar Pro, MuseScore, TuxGuitar). */
export function downloadGp(at: AT, api: AlphaTabNS.AlphaTabApi, title: string) {
  if (!api.score) return;
  // The recorded-guitar sounds live on spare programs locally; export them as standard nylon/steel.
  const programs = api.score.tracks.map((t) => t.playbackInfo.program);
  for (const t of api.score.tracks) t.playbackInfo.program = ({ 105: 24, 106: 25 } as Record<number, number>)[t.playbackInfo.program] ?? t.playbackInfo.program;
  let bytes: Uint8Array;
  try {
    bytes = new at.exporter.Gp7Exporter().export(api.score, api.settings);
  } finally {
    api.score.tracks.forEach((t, i) => { t.playbackInfo.program = programs[i]; });
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${title.replace(/[^\w\- ]+/g, "").trim() || "arrangement"}.gp` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
