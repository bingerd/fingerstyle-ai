import type * as AlphaTabNS from "@coderline/alphatab";

type AT = typeof AlphaTabNS;

/**
 * Expressive playback: a real fingerstyle player voices the melody over the bass and rolls full
 * chords slightly. alphaTab derives each note's MIDI velocity from note.dynamics, so this changes
 * the sound without adding dynamics marks to the tab. Big chords get a quick roll (arpeggio).
 */
export function humanize(at: AT, score: AlphaTabNS.model.Score) {
  const D = at.model.DynamicValue;
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
              if (n === top) n.dynamics = downbeat ? D.FF : D.F; // melody sings
              else if (n === bottom) n.dynamics = D.MF; // thumb bass
              else n.dynamics = D.P; // inner voices stay underneath
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
  const bytes = new at.exporter.Gp7Exporter().export(api.score, api.settings);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${title.replace(/[^\w\- ]+/g, "").trim() || "arrangement"}.gp` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
