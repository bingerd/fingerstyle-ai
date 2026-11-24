"use client";

import { useState, type ReactNode } from "react";

export type ToolTab = { id: string; label: string; badge?: string | number; content: ReactNode };

/**
 * Secondary tools under the score, closed by default so the tab stays the main event.
 * Click a tab to open its panel, click it again to close.
 */
export function ToolTabs({ tabs, open: controlled, onOpenChange }: { tabs: ToolTab[]; open?: string | null; onOpenChange?: (id: string | null) => void }) {
  const [own, setOwn] = useState<string | null>(null);
  const open = controlled !== undefined ? controlled : own;
  const set = (id: string | null) => (onOpenChange ? onOpenChange(id) : setOwn(id));
  const current = tabs.find((t) => t.id === open);
  return (
    <section aria-label="Study tools">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id} role="tab" aria-selected={open === t.id} onClick={() => set(open === t.id ? null : t.id)}
            className={`focus-ring flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${open === t.id ? "border-ink bg-ink text-bg" : "border-line text-ink-2 hover:border-ink-3 hover:text-ink"}`}
          >
            {t.label}
            {t.badge !== undefined && t.badge !== 0 && (
              <span className={`rounded-full px-1.5 text-[11px] font-semibold ${open === t.id ? "bg-bg/20" : "bg-surface-2 text-ink-3"}`}>{t.badge}</span>
            )}
          </button>
        ))}
        {current && <button onClick={() => set(null)} className="focus-ring ml-auto rounded-full px-2 text-sm text-ink-3 hover:text-ink" aria-label="Close panel">Close ✕</button>}
      </div>
      {current && <div role="tabpanel" className="rise mt-3">{current.content}</div>}
    </section>
  );
}
