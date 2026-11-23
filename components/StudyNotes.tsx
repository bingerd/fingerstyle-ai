import type { TasteNote } from "@/lib/ir/schema";

const KIND_LABEL: Record<TasteNote["kind"], string> = {
  "voice-leading": "Voice leading",
  style: "Style",
  technique: "Technique",
  practice: "Practice",
  listen: "Listen",
};

export function StudyNotes({ notes }: { notes: TasteNote[] }) {
  if (!notes.length) return null;
  return (
    <section aria-labelledby="study-notes">
      <h2 id="study-notes" className="mb-3 font-display text-2xl font-semibold">Taste notes</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {notes.map((n, i) => (
          <article key={i} className="card rise p-4" style={{ animationDelay: `${i * 50}ms` }}>
            <p className="mb-1 text-[11px] font-medium tracking-widest text-accent uppercase">{KIND_LABEL[n.kind]}</p>
            <h3 className="mb-1.5 font-semibold leading-snug">{n.title}</h3>
            <p className="text-sm leading-relaxed text-ink-2">{n.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
