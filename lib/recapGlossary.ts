/** Từ điển dùng chung cho biên bản họp: học từ những chỗ người ghi biên bản sửa tay. */

export type GlossarySuggestion = { wrong: string; right: string };

export type GlossaryTerm = { text: string; heardAs: string | null };

export const GLOSSARY_TEXT_MAX = 120;
export const GLOSSARY_RULE_MAX = 240;
export const GLOSSARY_SUGGESTIONS_MAX = 30;
/** Số mục tối đa đưa vào prompt Gemini; gợi ý chép lời của Groq còn ngắn hơn (RECAP_TRANSCRIPT_PROMPT_MAX). */
export const GLOSSARY_PROMPT_TERMS_MAX = 150;
export const GLOSSARY_PROMPT_RULES_MAX = 30;

const SPAN_WORDS_MAX = 4;
const DIFF_CELLS_MAX = 4_000_000;

const stripMarks = (value: string) => value.replace(/[\p{P}\p{S}]+/gu, "").trim();

type Token = { raw: string; key: string };

/** `key` bỏ dấu câu để "rồi," và "rồi" coi là cùng một từ; `raw` giữ nguyên để hiển thị. */
function tokenize(content: string): Token[] {
  return content
    .split(/\s+/)
    .filter((token) => token && !/^[#\-*•]+$/.test(token))
    .map((raw) => ({ raw, key: stripMarks(raw) }))
    .filter((token) => token.key);
}

type Span = { removed: string[]; added: string[] };

/** So hai bản theo từ; trả về các cụm bị thay (có cả phần bỏ đi và phần thêm vào). */
function replacedSpans(before: Token[], after: Token[]): Span[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start].key === after[start].key) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1].key === after[endAfter - 1].key) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const a = before.slice(start, endBefore);
  const b = after.slice(start, endAfter);
  if (a.length === 0 || b.length === 0) return [];
  if ((a.length + 1) * (b.length + 1) > DIFF_CELLS_MAX) return [];

  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i].key === b[j].key
          ? Math.min(65535, table[(i + 1) * width + j + 1] + 1)
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const spans: Span[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    if (removed.length && added.length) spans.push({ removed, added });
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].key === b[j].key) {
      flush();
      i += 1;
      j += 1;
    } else if (j >= b.length || (i < a.length && table[(i + 1) * width + j] >= table[i * width + j + 1])) {
      removed.push(a[i].raw);
      i += 1;
    } else {
      added.push(b[j].raw);
      j += 1;
    }
  }
  flush();
  return spans;
}

/**
 * Những chỗ người ghi biên bản đã đổi từ/cụm từ (tối đa 4 từ mỗi bên). Bỏ qua chỗ chỉ đổi dấu câu,
 * chỗ chỉ đổi số liệu, và chỗ viết lại cả câu.
 */
export function suggestGlossaryFromEdit(before: string, after: string): GlossarySuggestion[] {
  const seen = new Set<string>();
  const result: GlossarySuggestion[] = [];
  for (const span of replacedSpans(tokenize(before), tokenize(after))) {
    if (span.removed.length > SPAN_WORDS_MAX || span.added.length > SPAN_WORDS_MAX) continue;
    const wrong = span.removed.join(" ");
    const right = span.added.join(" ");
    if (!/\p{L}/u.test(right) || !/\p{L}/u.test(wrong)) continue;
    if (stripMarks(wrong) === stripMarks(right)) continue;
    const cleanWrong = wrong.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    const cleanRight = right.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!cleanWrong || !cleanRight || cleanRight.length > GLOSSARY_TEXT_MAX) continue;
    const key = `${cleanWrong.toLocaleLowerCase("vi")}|${cleanRight.toLocaleLowerCase("vi")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ wrong: cleanWrong, right: cleanRight });
  }
  return result;
}

/** Gộp gợi ý mới vào danh sách đang chờ; bỏ trùng và những từ đã có trong từ điển. */
export function mergeGlossarySuggestions(
  pending: GlossarySuggestion[],
  incoming: GlossarySuggestion[],
  knownTerms: string[] = []
): GlossarySuggestion[] {
  const known = new Set(knownTerms.map((term) => term.toLocaleLowerCase("vi")));
  const seen = new Set<string>();
  const merged: GlossarySuggestion[] = [];
  for (const item of [...pending, ...incoming]) {
    if (known.has(item.right.toLocaleLowerCase("vi"))) continue;
    const key = `${item.wrong.toLocaleLowerCase("vi")}|${item.right.toLocaleLowerCase("vi")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(-GLOSSARY_SUGGESTIONS_MAX);
}

export function readGlossarySuggestions(value: unknown): GlossarySuggestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const wrong = typeof row.wrong === "string" ? row.wrong.trim().slice(0, GLOSSARY_TEXT_MAX) : "";
    const right = typeof row.right === "string" ? row.right.trim().slice(0, GLOSSARY_TEXT_MAX) : "";
    return wrong && right ? [{ wrong, right }] : [];
  });
}

/** Thêm cách chép sai mới vào ô "hay bị chép thành"; không lặp và không quá dài. */
export function addHeardAs(current: string | null, next: string): string {
  const parts = (current ?? "").split(" / ").map((part) => part.trim()).filter(Boolean);
  if (!parts.some((part) => part.toLocaleLowerCase("vi") === next.toLocaleLowerCase("vi"))) parts.push(next);
  return parts.slice(-3).join(" / ").slice(0, GLOSSARY_TEXT_MAX * 2);
}

/** Phần prompt Gemini: từ điển và quy tắc viết của công ty. */
export function glossaryPromptLines(terms: GlossaryTerm[], rules: string[]): string[] {
  const lines: string[] = [];
  const termLines = terms.slice(0, GLOSSARY_PROMPT_TERMS_MAX).map((term) =>
    term.heardAs ? `- ${term.text} (máy hay chép thành: ${term.heardAs})` : `- ${term.text}`
  );
  if (termLines.length) {
    lines.push("Từ điển của công ty. Gặp từ nào gần giống thì viết đúng như dưới đây:", ...termLines);
  }
  const ruleLines = rules.slice(0, GLOSSARY_PROMPT_RULES_MAX).map((rule) => `- ${rule}`);
  if (ruleLines.length) lines.push("Quy tắc viết của công ty:", ...ruleLines);
  return lines;
}
