"use client";

import type { Song } from "@/lib/ir/schema";
import { ChordDiagram } from "./ChordDiagram";

/** Section-by-section chord chart. Each chord is a button that opens the reharm panel. */
export function ChordTimeline({
  song,
  selectedId,
  activeId,
  changedIds,
  onSelect,
}: {
  song: Song;
  selectedId: string | null;
  activeId: string | null;
  changedIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  let barNo = 0;
  return (
    <div className="space-y-5">
      {song.sections.map((section, si) => (
        <div key={si} className="rise" style={{ animationDelay: `${si * 60}ms` }}>
          <div className="mb-2 flex items-baseline gap-3">
            <h3 className="font-display text-lg font-semibold">{section.name}</h3>
            <p className="text-sm text-ink-2">{section.note}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {section.bars.map((bar, bi) => {
              barNo++;
              return (
                <div key={bi} className="flex min-h-44 rounded-xl border border-line bg-surface-2/60 p-1.5">
                  <span className="w-5 pt-0.5 font-mono text-[10px] text-ink-3">{barNo}</span>
                  <div className="flex flex-1 gap-1.5">
                    {bar.chords.map((c) => {
                      const selected = c.id === selectedId;
                      const active = c.id === activeId;
                      return (
                        <button
                          key={c.id}
                          onClick={() => onSelect(c.id)}
                          aria-pressed={selected}
                          title="Click to reharmonize"
                          className={`focus-ring group flex flex-1 flex-col items-center rounded-lg border px-1 py-1.5 text-center transition
                            ${selected ? "border-accent bg-surface shadow-card" : active ? "border-accent/60 bg-accent-soft" : "border-transparent hover:border-line hover:bg-surface"}`}
                        >
                          <span className="font-display text-[1.15rem] leading-tight font-semibold">
                            {c.symbol}
                            {changedIds.has(c.id) && <span className="ml-1 align-super text-[10px] text-accent" title="Reharmonized">●</span>}
                          </span>
                          <span className="mb-1 font-mono text-[11px] text-ink-3">{c.roman}</span>
                          <ChordDiagram voicing={c.voicing} size={bar.chords.length === 1 ? 1.35 : bar.chords.length === 2 ? 1.05 : 0.8} accent={selected || active} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
