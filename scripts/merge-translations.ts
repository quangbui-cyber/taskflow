import { prisma } from "../lib/prisma";
import fs from "fs";
import path from "path";

async function main() {
  const dir = path.join(process.cwd(), "scripts", "translations");
  const b1Path = path.join(dir, "batch-1-output.json");
  const b2Path = path.join(dir, "batch-2-output.json");
  const b3Path = path.join(dir, "batch-3-output.json");

  const translations: Record<string, any[]> = {};

  if (fs.existsSync(b1Path)) {
    const data = JSON.parse(fs.readFileSync(b1Path, "utf-8"));
    Object.assign(translations, data);
    console.log("Loaded batch 1:", Object.keys(data).length, "articles");
  } else {
    console.log("Batch 1 not ready yet");
  }

  if (fs.existsSync(b2Path)) {
    const data = JSON.parse(fs.readFileSync(b2Path, "utf-8"));
    Object.assign(translations, data);
    console.log("Loaded batch 2:", Object.keys(data).length, "articles");
  } else {
    console.log("Batch 2 not ready yet");
  }

  if (fs.existsSync(b3Path)) {
    const data = JSON.parse(fs.readFileSync(b3Path, "utf-8"));
    Object.assign(translations, data);
    console.log("Loaded batch 3:", Object.keys(data).length, "articles");
  } else {
    console.log("Batch 3 not ready yet");
  }

  const slugs = Object.keys(translations);
  console.log(`Total translated articles to update: ${slugs.length}`);

  let updatedCount = 0;
  for (const slug of slugs) {
    const linesVi = translations[slug];
    if (Array.isArray(linesVi) && linesVi.length > 0) {
      await prisma.creativeArticle.updateMany({
        where: { slug },
        data: { linesVi: linesVi as any },
      });
      updatedCount++;
    }
  }
  console.log(`Updated ${updatedCount} articles in database.`);

  // Cập nhật lại file lib/creativeSeedData.json để Vercel deploy luôn có đủ
  const allArticles = await prisma.creativeArticle.findMany({
    orderBy: { createdAt: "desc" },
  });
  const seedPath = path.join(process.cwd(), "lib", "creativeSeedData.json");
  fs.writeFileSync(seedPath, JSON.stringify(allArticles, null, 2), "utf-8");
  console.log(`Updated lib/creativeSeedData.json with ${allArticles.length} articles!`);

  const withVi = allArticles.filter((a) => Array.isArray(a.linesVi) && a.linesVi.length > 0);
  console.log(`Total articles now with Vietnamese lines: ${withVi.length}/50`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

