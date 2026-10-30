const URL_CANDIDATE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?\])}]+$/;

export type TextLink = {
  href: string;
  label: string;
};

export function extractTextLinks(text: string): TextLink[] {
  const links: TextLink[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(URL_CANDIDATE)) {
    const label = match[0].replace(TRAILING_PUNCTUATION, "");
    const candidate = label.startsWith("www.") ? `https://${label}` : label;

    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (seen.has(url.href)) continue;

      seen.add(url.href);
      links.push({ href: url.href, label });
    } catch {
      // Ignore incomplete URLs while the user is typing.
    }
  }

  return links;
}
