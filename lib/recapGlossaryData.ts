import { prisma } from "@/lib/prisma";
import { GLOSSARY_PROMPT_RULES_MAX, GLOSSARY_PROMPT_TERMS_MAX, type GlossaryTerm } from "@/lib/recapGlossary";

/** Từ điển đưa vào prompt: mục dùng nhiều và mới nhất đứng trước, có trần số lượng. */
export async function loadRecapGlossary(): Promise<{ terms: GlossaryTerm[]; rules: string[] }> {
  const [terms, rules] = await Promise.all([
    prisma.recapGlossaryTerm.findMany({
      where: { kind: "TERM" },
      orderBy: [{ useCount: "desc" }, { updatedAt: "desc" }],
      take: GLOSSARY_PROMPT_TERMS_MAX,
      select: { text: true, heardAs: true },
    }),
    prisma.recapGlossaryTerm.findMany({
      where: { kind: "RULE" },
      orderBy: { createdAt: "asc" },
      take: GLOSSARY_PROMPT_RULES_MAX,
      select: { text: true },
    }),
  ]);
  return { terms, rules: rules.map((rule) => rule.text) };
}
