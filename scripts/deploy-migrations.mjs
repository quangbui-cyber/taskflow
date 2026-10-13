import { spawnSync } from "node:child_process";

const forced = process.argv.includes("--force");
const productionDeploy =
  process.env.VERCEL_ENV === "production" ||
  process.env.CLOUDFLARE_DEPLOY === "1" ||
  forced;

if (!productionDeploy) {
  console.log("Skipping production migrations outside an explicit production deploy.");
  process.exit(0);
}

const retryDelays = [0, 5_000, 15_000, 30_000];
const transientErrors = /P1001|P1002|P1008|P1017/;

for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
  const delay = retryDelays[attempt];
  if (delay > 0) {
    console.log(`Retrying database migrations in ${delay / 1_000}s...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const result = spawnSync(
    process.platform === "win32"
      ? "node_modules/.bin/prisma.cmd"
      : "node_modules/.bin/prisma",
    ["migrate", "deploy"],
    { encoding: "utf8", env: process.env }
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status === 0) process.exit(0);

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const canRetry = transientErrors.test(output);
  const isLastAttempt = attempt === retryDelays.length - 1;

  if (!canRetry || isLastAttempt) {
    process.exit(result.status ?? 1);
  }
}
