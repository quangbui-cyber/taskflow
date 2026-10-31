import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";

const revisedDir = path.join(__dirname, "translations", "revised");
const all150Path = path.join(revisedDir, "all-150.json");
const flagshipsPath = path.join(revisedDir, "flagships-10.json");
const seedDataPath = path.join(__dirname, "..", "lib", "creativeSeedData.json");

async function main() {
  console.log("Reading all-150.json and flagships-10.json...");
  const all150 = JSON.parse(fs.readFileSync(all150Path, "utf-8"));
  const flagships = JSON.parse(fs.readFileSync(flagshipsPath, "utf-8"));

  // 1. Merge flagships into all150
  for (const [slug, data] of Object.entries(flagships)) {
    all150[slug] = data;
    console.log(`Merged flagship 9.5: ${slug} -> "${(data as any).titleVi}"`);
  }
  fs.writeFileSync(all150Path, JSON.stringify(all150, null, 2) + "\n");
  console.log("Updated all-150.json.");

  // 2. Update lib/creativeSeedData.json
  const seedArticles = JSON.parse(fs.readFileSync(seedDataPath, "utf-8"));
  let updatedInSeed = 0;
  for (const item of seedArticles) {
    if (all150[item.slug]) {
      item.titleVi = all150[item.slug].titleVi;
      item.linesVi = all150[item.slug].linesVi;
      updatedInSeed++;
    }
  }
  fs.writeFileSync(seedDataPath, JSON.stringify(seedArticles, null, 2) + "\n");
  console.log(`Updated ${updatedInSeed} articles in lib/creativeSeedData.json.`);

  // 3. Update PostgreSQL database
  console.log("Syncing updated articles into PostgreSQL database...");
  for (const [slug, item] of Object.entries(flagships) as [string, any][]) {
    await prisma.creativeArticle.update({
      where: { slug },
      data: {
        titleVi: item.titleVi,
        linesVi: item.linesVi,
      },
    });
    console.log(`Updated DB: ${slug}`);
  }
  console.log("Database sync complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
