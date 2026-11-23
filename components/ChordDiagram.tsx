import type { Voicing } from "@/lib/ir/schema";

/** Vertical chord-box diagram. Frets are low E first; drawn low E on the left. */
export function ChordDiagram({ voicing, size = 1, accent = false }: { voicing: Voicing; size?: number; accent?: boolean }) {
  const { frets, fingers } = voicing;
  const fretted = frets.filter((f) => f > 0);
  const maxF = fretted.length ? Math.max(...fretted) : 0;
  const minF = fretted.length ? Math.min(...fretted) : 0;
  const rows = Math.max(4, maxF - minF + 1);
  const base = maxF <= 4 ? 1 : minF;

  const w = 64, padX = 10, padTop = 16, gapX = (w - padX * 2) / 5, gapY = 12;
  const h = padTop + rows * gapY + 6;
  const x = (s: number) => padX + s * gapX;
  const y = (row: number) => padTop + row * gapY;
  const dot = accent ? "var(--accent)" : "var(--ink)";

  return (
    <svg
      viewBox={`0 0 ${w + 12} ${h}`}
      width={(w + 12) * size}
      height={h * size}
      role="img"
      aria-label={`Chord diagram, frets ${frets.map((f) => (f < 0 ? "x" : f)).join(" ")}`}
      className="shrink-0"
    >
      {base === 1 ? (
        <rect x={x(0) - 1} y={y(0) - 3} width={x(5) - x(0) + 2} height={3} rx={1} fill="var(--ink)" />
      ) : (
        <text x={x(5) + 5} y={y(0) + gapY * 0.7} fontSize={8} fill="var(--ink-2)" fontFamily="var(--font-mono)">
          {base}
        </text>
      )}
      {Array.from({ length: rows + 1 }, (_, r) => (
        <line key={`r${r}`} x1={x(0)} x2={x(5)} y1={y(r)} y2={y(r)} stroke="var(--ink-3)" strokeWidth={0.8} />
      ))}
      {Array.from({ length: 6 }, (_, s) => (
        <line key={`s${s}`} x1={x(s)} x2={x(s)} y1={y(0)} y2={y(rows)} stroke="var(--ink-3)" strokeWidth={0.8} />
      ))}
      {frets.map((f, s) => {
        if (f < 0)
          return (
            <text key={s} x={x(s)} y={padTop - 6} fontSize={8} textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--font-mono)">
              ×
            </text>
          );
        if (f === 0) return <circle key={s} cx={x(s)} cy={padTop - 8} r={2.6} fill="none" stroke="var(--ink-2)" strokeWidth={0.9} />;
        const row = f - base;
        return (
          <g key={s}>
            <circle cx={x(s)} cy={y(row) + gapY / 2} r={4.4} fill={dot} />
            {fingers[s] > 0 && (
              <text x={x(s)} y={y(row) + gapY / 2 + 2.6} fontSize={6.5} textAnchor="middle" fill="var(--surface)" fontWeight={700}>
                {fingers[s] === 5 ? "T" : fingers[s]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
