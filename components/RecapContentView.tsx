import {
  isOpenQuestionSection,
  isRecapPlaceholder,
  isSummarySection,
  parseExportActionLine,
  parseRecapSections,
  type RecapSection,
} from "@/lib/meetingRecap";

function Badge({ n, warn = false }: { n: number; warn?: boolean }) {
  return (
    <span
      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        warn ? "bg-amber-100 text-amber-800" : "bg-brand-400 text-zinc-950"
      }`}
    >
      {n}
    </span>
  );
}

function ItemText({ item, warn }: { item: string; warn: boolean }) {
  const action = parseExportActionLine(item);
  if (!action) return <span className={warn ? "text-zinc-800" : "font-medium text-zinc-900"}>{item}</span>;
  return (
    <span className="min-w-0">
      <span className="block font-medium text-zinc-900">{action.title}</span>
      <span className="block text-sm text-zinc-500">
        {action.owner} · Hạn {action.due}
        {action.done && <span className="text-brand-700"> · Đã xong</span>}
      </span>
    </span>
  );
}

function NumberedList({ items, warn }: { items: string[]; warn: boolean }) {
  if (items.length === 1 && isRecapPlaceholder(items[0])) {
    return <p className="text-sm text-zinc-500">{items[0]}</p>;
  }
  return (
    <ol className="divide-y divide-zinc-100 overflow-hidden rounded-[14px] border border-zinc-200">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3 px-4 py-3 text-[15px] leading-6">
          <Badge n={index + 1} warn={warn} />
          <ItemText item={item} warn={warn} />
        </li>
      ))}
    </ol>
  );
}

function Section({ section }: { section: RecapSection }) {
  const warn = isOpenQuestionSection(section.title);
  return (
    <section className="space-y-2.5">
      {section.title && <h2 className="text-sm font-semibold text-zinc-500">{section.title}</h2>}
      {section.paragraphs.map((text, index) => (
        <p key={index} className="text-[15px] leading-7 text-zinc-800">
          {text}
        </p>
      ))}
      {section.topics.length > 0 && (
        <div className="space-y-3">
          {section.topics.map((topic, index) => (
            <article key={index} className="overflow-hidden rounded-[14px] border border-zinc-200">
              <header className="flex items-start gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-3">
                <Badge n={index + 1} />
                <h3 className="text-[15px] font-semibold leading-6 text-zinc-950">{topic.title}</h3>
              </header>
              {(topic.points.length > 0 || topic.notes.length > 0) && (
                <div className="space-y-1.5 px-4 py-3 text-[15px] leading-7 text-zinc-700">
                  {topic.notes.map((text, noteIndex) => (
                    <p key={noteIndex}>{text}</p>
                  ))}
                  {topic.points.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 marker:text-zinc-400">
                      {topic.points.map((point, pointIndex) => (
                        <li key={pointIndex}>{point}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {topic.conclusion && (
                <p className="border-t border-brand-100 bg-brand-50 px-4 py-3 text-[15px] font-medium leading-6 text-zinc-900">
                  Kết luận: {topic.conclusion}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      {section.items.length > 0 &&
        (isSummarySection(section.title) ? (
          <ul className="list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-zinc-800 marker:text-brand-500">
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
    <div className="space-y-7">
      {parseRecapSections(content).map((section, index) => (
        <Section key={index} section={section} />
      ))}
    </div>
  );
}
