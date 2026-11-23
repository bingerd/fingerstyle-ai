import type { ChordEvent, RhythmEvent, Song } from "./schema";

/** Offline demo song: lets the UI work end-to-end without an API key. */

const bossa: RhythmEvent[] = [
  { value: 4, dotted: false, play: "bass" },
  { value: 8, dotted: false, play: "upper" },
  { value: 8, dotted: false, play: "upper" },
  { value: 4, dotted: false, play: "bass" },
  { value: 8, dotted: false, play: "upper" },
  { value: 8, dotted: false, play: "rest" },
];

const ch = (id: string, symbol: string, roman: string, frets: number[], fingers: number[]): ChordEvent => ({
  id, symbol, roman, voicing: { frets, fingers }, rhythm: bossa,
});

export const DEMO_SONG: Song = {
  title: "ii–V–I Study in C",
  style: "Bossa nova",
  key: "C major",
  tempo: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  difficulty: "intermediate",
  texture: "comping",
  tuning: "standard",
  capo: 0,
  transpose: 0,
  summary:
    "A classic ii–V–I cycle dressed in bossa nova clothing: thumb on the bass (beats 1 and 3), fingers pluck the upper voices on the off-beats. Voicings stay in 3rd–7th position so the guide tones move by half-step.",
  sections: [
    {
      name: "A",
      note: "Listen for the 7th of Dm9 (C) falling a half-step to the 3rd of G13 (B), then G13's 7th (F) resolving to E in Cmaj9.",
      bars: [
        { chords: [ch("c1", "Dm9", "ii9", [-1, 5, 3, 5, 5, -1], [0, 2, 1, 3, 4, 0])], beats: [] },
        { chords: [ch("c2", "G13", "V13", [3, -1, 3, 4, 5, -1], [2, 0, 1, 3, 4, 0])], beats: [] },
        { chords: [ch("c3", "Cmaj9", "Imaj9", [-1, 3, 2, 4, 3, -1], [0, 2, 1, 4, 3, 0])], beats: [] },
        { chords: [ch("c4", "A7b9", "V7/ii", [5, -1, 5, 6, 5, 6], [1, 0, 1, 2, 1, 3])], beats: [] },
      ],
    },
    {
      name: "B",
      note: "Same cycle with leaner voicings — a chance to hear how much colour the 9ths and 13ths added in A.",
      bars: [
        { chords: [ch("c5", "Dm7", "ii7", [-1, 5, 7, 5, 6, -1], [0, 1, 3, 1, 2, 0])], beats: [] },
        { chords: [ch("c6", "G7", "V7", [3, -1, 3, 4, 3, -1], [1, 0, 1, 2, 1, 0])], beats: [] },
        { chords: [ch("c7", "C6/9", "I6/9", [-1, 3, 2, 2, 3, 3], [0, 2, 1, 1, 3, 4])], beats: [] },
        { chords: [ch("c8", "C6/9", "I6/9", [-1, 3, 2, 2, 3, 3], [0, 2, 1, 1, 3, 4])], beats: [] },
      ],
    },
  ],
  tasteNotes: [
    { kind: "voice-leading", title: "Guide tones move by half-step", body: "Track the 3rds and 7ths: C→B→B→… Each change moves one or two voices by a semitone while the rest hold." },
    { kind: "style", title: "The bossa thumb", body: "Keep the thumb steady on 1 and 3 like a surdo drum; the fingers are the syncopated tamborim." },
    { kind: "practice", title: "Slow loop the turnaround", body: "Loop bars 3–4 at 70 bpm until the A7b9 grip lands without looking." },
  ],
};
