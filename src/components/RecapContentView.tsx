import {
  isOpenQuestionSection,
  isRecapPlaceholder,
  isSummarySection,
  parseRecapSections,
  type RecapSection,
} from "@/lib/meetingRecap";

function Badge({ n, warn = false }: { n: number; warn?: boolean }) {
  return (
    <span
      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        warn
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200"
          : "bg-brand-600 text-white"
      }`}
    >
      {n}
    </span>
  );
}

function NumberedList({ items, warn }: { items: string[]; warn: boolean }) {
  if (items.length === 1 && isRecapPlaceholder(items[0])) {
    return <p className="text-sm text-muted">{items[0]}</p>;
  }
  return (
    <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3 px-4 py-3 text-sm leading-6">
          <Badge n={index + 1} warn={warn} />
          <span className={warn ? "text-ink" : "font-medium text-ink"}>{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Section({ section }: { section: RecapSection }) {
  const warn = isOpenQuestionSection(section.title);
  return (
    <section className="space-y-2.5">
      {section.title && <h3 className="text-sm font-semibold text-muted">{section.title}</h3>}
      {section.paragraphs.map((text, index) => (
        <p key={index} className="text-sm leading-7 text-ink">
          {text}
        </p>
      ))}
      {section.topics.length > 0 && (
        <div className="space-y-3">
          {section.topics.map((topic, index) => (
            <article key={index} className="overflow-hidden rounded-xl border border-line">
              <header className="flex items-start gap-3 border-b border-line bg-brand-50/40 px-4 py-3 dark:bg-brand-950/20">
                <Badge n={index + 1} />
                <h4 className="text-sm font-semibold leading-6 text-ink">{topic.title}</h4>
              </header>
              {(topic.points.length > 0 || topic.notes.length > 0) && (
                <div className="space-y-1.5 px-4 py-3 text-sm leading-7 text-ink">
                  {topic.notes.map((text, noteIndex) => (
                    <p key={noteIndex}>{text}</p>
                  ))}
                  {topic.points.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 marker:text-muted">
                      {topic.points.map((point, pointIndex) => (
                        <li key={pointIndex}>{point}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {topic.conclusion && (
                <p className="border-t border-brand-200/60 bg-brand-50 px-4 py-2.5 text-sm font-medium leading-6 text-brand-950 dark:border-brand-900/50 dark:bg-brand-950/40 dark:text-brand-100">
                  Kết luận: {topic.conclusion}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      {section.items.length > 0 &&
        (isSummarySection(section.title) ? (
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-7 text-ink marker:text-brand-500">
            {section.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        ) : (
          <NumberedList items={section.items} warn={warn} />
        ))}
    </section>
  );
}

/** Biên bản trình bày dạng thẻ: mỗi chủ đề một khối, kết luận nổi bật, quyết định và vấn đề đánh số. */
export default function RecapContentView({ content }: { content: string }) {
  return (
    <div className="space-y-6">
      {parseRecapSections(content).map((section, index) => (
        <Section key={index} section={section} />
      ))}
    </div>
  );
}
