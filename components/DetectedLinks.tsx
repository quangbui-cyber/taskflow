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
          className="inline-flex max-w-full items-center gap-1.5 rounded-[7px] border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 transition-colors hover:border-emerald-300 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
        >
          <ExternalLink size={13} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{link.label}</span>
        </a>
      ))}
    </div>
  );
}
