import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const aiRoot = path.resolve(import.meta.dirname, "../lib/ai");

function productionAiFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionAiFiles(target);
    return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
  });
}

function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

test("production AI modules cannot import or call authoritative business mutations", () => {
  const forbiddenImport =
    /(?:from\s*|import\s*\()\s*["'][^"']*(?:approval|payment|cash|sign(?:ature|ing)?|task(?:s|-completion)|settlement|financial[-_/]?close)[^"']*["']/i;
  const forbiddenCall =
    /\b(?:approve\w*|authorizePayment|createPayment|recordCash|disburse\w*|signDocument|completeTask|settle\w*|closeFinancial\w*)\s*\(/i;
  const violations: string[] = [];

  for (const file of productionAiFiles(aiRoot)) {
    const source = withoutComments(readFileSync(file, "utf8"));
    if (forbiddenImport.test(source)) violations.push(`${path.relative(aiRoot, file)}:import`);
    if (forbiddenCall.test(source)) violations.push(`${path.relative(aiRoot, file)}:call`);
  }

  assert.deepEqual(violations, []);
});

test("authority scanner ignores comments but detects production imports and calls", () => {
  const commented = withoutComments(`
    // import { approve } from "@/lib/costflow/approval";
    /* completeTask(); recordCash(); */
    export const safe = true;
  `);
  assert.equal(commented.includes("approve"), false);
  assert.equal(commented.includes("completeTask"), false);
});
