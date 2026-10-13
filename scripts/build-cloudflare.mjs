import { spawn } from "node:child_process";
import { copyFile, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const proxyPath = path.join(appRoot, "proxy.ts");
const parkedProxyPath = path.join(appRoot, ".proxy.cloudflare-build.ts");
const middlewarePath = path.join(appRoot, "middleware.ts");
const cloudflareMiddlewarePath = path.join(appRoot, "cloudflare", "middleware.ts");
const prismaSchemaPath = path.join(appRoot, "prisma", "schema.prisma");
const openNextCliPath = path.join(
  appRoot,
  "node_modules",
  "@opennextjs",
  "cloudflare",
  "dist",
  "cli",
  "index.js",
);
const prismaCliPath = path.join(appRoot, "node_modules", "prisma", "build", "index.js");
const prismaGeneratorMarker = '  provider = "prisma-client-js"';
const cloudflarePrismaGenerator = `${prismaGeneratorMarker}\n  engineType = "client"`;

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function restoreProxy() {
  await rm(middlewarePath, { force: true });
  if ((await exists(parkedProxyPath)) && !(await exists(proxyPath))) {
    await rename(parkedProxyPath, proxyPath);
  }
}

async function runOpenNextBuild() {
  await runNodeCli(openNextCliPath, ["build"], "OpenNext build", {
    TASKFLOW_CLOUDFLARE_BUILD: "1",
  });
}

async function runPrismaGenerate() {
  await runNodeCli(prismaCliPath, ["generate"], "Prisma generate");
}

async function runNodeCli(cliPath, args, label, extraEnv = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: appRoot,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `${label} terminated by signal ${signal}.`
            : `${label} exited with code ${code}.`,
        ),
      );
    });
  });
}

await restoreProxy();

if (await exists(middlewarePath)) {
  throw new Error("middleware.ts already exists; refusing to overwrite it.");
}

const originalPrismaSchema = await readFile(prismaSchemaPath, "utf8");
if (!originalPrismaSchema.includes(prismaGeneratorMarker)) {
  throw new Error("Prisma client generator marker is missing; refusing to patch the schema.");
}
if (originalPrismaSchema.includes('engineType = "client"')) {
  throw new Error("Prisma schema is already configured for the client engine.");
}

await rename(proxyPath, parkedProxyPath);
await copyFile(cloudflareMiddlewarePath, middlewarePath);
await writeFile(
  prismaSchemaPath,
  originalPrismaSchema.replace(prismaGeneratorMarker, cloudflarePrismaGenerator),
  "utf8",
);

let buildError;
try {
  await runPrismaGenerate();
  await runOpenNextBuild();
} catch (error) {
  buildError = error;
} finally {
  await writeFile(prismaSchemaPath, originalPrismaSchema, "utf8");
  await restoreProxy();
  try {
    await runPrismaGenerate();
  } catch (restoreError) {
    if (!buildError) buildError = restoreError;
  }
}

if (buildError) throw buildError;
