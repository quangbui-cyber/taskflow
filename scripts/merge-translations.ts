import { prisma } from "../lib/prisma";
import fs from "fs";
import path from "path";
import type { Prisma } from "@prisma/client";

type Translation = Prisma.InputJsonArray | {
  titleVi?: string;
  tags?: string[];
  linesVi?: Prisma.InputJsonArray;
};

async function main() {
  const dir = path.join(process.cwd(), "scripts", "translations");

  const translations: Record<string, Translation> = {};

  for (let b = 1; b <= 8; b++) {
    const bPath = path.join(dir, `batch-${b}-output.json`);
    if (fs.existsSync(bPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(bPath, "utf-8"));
        Object.assign(translations, data);
        console.log(`✅ Loaded batch ${b}: ${Object.keys(data).length} articles`);
      } catch (err) {
        console.error(`❌ Error parsing batch ${b}:`, err);
      }
    } else {
      console.log(`⏳ Batch ${b} not ready yet`);
    }
  }

  const slugs = Object.keys(translations);
  console.log(`\nTotal translated articles to process: ${slugs.length}`);

  let updatedCount = 0;
  for (const slug of slugs) {
    const item = translations[slug];
    if (!item) continue;

    if (Array.isArray(item)) {
      // Định dạng cũ (chỉ chứa linesVi)
      await prisma.creativeArticle.updateMany({
        where: { slug },
        data: {
          linesVi: item,
          status: "PUBLISHED",
        },
      });
      updatedCount++;
    } else if (typeof item === "object") {
      // Định dạng mới ({ titleVi, tags, linesVi })
      const translated = item as Exclude<Translation, Prisma.InputJsonArray>;
      const updateData: Prisma.CreativeArticleUpdateManyMutationInput = {
        status: "PUBLISHED",
      };
      if (translated.titleVi) updateData.titleVi = translated.titleVi;
      if (Array.isArray(translated.tags) && translated.tags.length > 0) updateData.tags = translated.tags;
      if (Array.isArray(translated.linesVi) && translated.linesVi.length > 0) updateData.linesVi = translated.linesVi;

      await prisma.creativeArticle.updateMany({
        where: { slug },
        data: updateData,
      });
      updatedCount++;
    }
  }
  console.log(`🎉 Updated ${updatedCount} articles in database.`);

  // Cập nhật lại file lib/creativeSeedData.json để Vercel deploy luôn có đủ 150 bài
  const allArticles = await prisma.creativeArticle.findMany({
    orderBy: { createdAt: "desc" },
  });
  const seedPath = path.join(process.cwd(), "lib", "creativeSeedData.json");
  fs.writeFileSync(seedPath, JSON.stringify(allArticles, null, 2), "utf-8");
  console.log(`Updated lib/creativeSeedData.json with ${allArticles.length} articles!`);

  const published = allArticles.filter((a) => a.status === "PUBLISHED");
  const withVi = allArticles.filter((a) => Array.isArray(a.linesVi) && a.linesVi.length > 0);
  console.log(`Total PUBLISHED articles: ${published.length}/${allArticles.length}`);
  console.log(`Total articles with Vietnamese translation: ${withVi.length}/${allArticles.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
