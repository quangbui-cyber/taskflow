import { ExternalLink } from "lucide-react";
import { extractTextLinks } from "@/lib/textLinks";

export default function DetectedLinks({ text }: { text: string }) {
  const links = extractTextLinks(text);
  if (links.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2" aria-label="Liên kết trong kết quả">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          title={link.label}
          className="inline-flex max-w-full items-center gap-1.5 rounded-[10px] border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition-[transform,background-color,border-color,color] duration-150 ease-out hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-400/30 motion-reduce:transform-none"
        >
          <ExternalLink size={13} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{link.label}</span>
        </a>
      ))}
    </div>
  );
}
