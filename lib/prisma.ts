import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { after } from "next/server";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

type OpenNextRequestCache = {
  getOrCreate<K, V>(key: string): Map<K, V>;
};

type OpenNextRequestStore = {
  requestCache?: OpenNextRequestCache;
};

type OpenNextAsyncStorage = {
  getStore(): OpenNextRequestStore | undefined;
};

const REQUEST_CACHE_NAMESPACE = "taskflow-prisma";
const REQUEST_CACHE_CLIENT_KEY = "client";

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required before Prisma can connect.");
  }

  let isNeon = false;
  try {
    isNeon = new URL(connectionString).hostname.endsWith(".neon.tech");
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  const adapter = isNeon
    ? new PrismaNeon({ connectionString })
    : new PrismaPg({ connectionString });

  return new PrismaClient({ adapter });
}

function getOpenNextRequestStore() {
  const runtimeGlobal = globalThis as typeof globalThis & {
    __openNextAls?: OpenNextAsyncStorage;
  };
  return runtimeGlobal.__openNextAls?.getStore();
}

function getRequestScopedClient(store: OpenNextRequestStore) {
  const requestClients = store.requestCache!.getOrCreate<string, PrismaClient>(
    REQUEST_CACHE_NAMESPACE
  );
  const existing = requestClients.get(REQUEST_CACHE_CLIENT_KEY);
  if (existing) return existing;

  const client = createPrismaClient();
  requestClients.set(REQUEST_CACHE_CLIENT_KEY, client);
  after(() => client.$disconnect());
  return client;
}

function getPrismaClient() {
  const requestStore = getOpenNextRequestStore();
  if (requestStore?.requestCache) {
    return getRequestScopedClient(requestStore);
  }

  // Node.js dev/server processes reuse one client. The Cloudflare OpenNext
  // adapter instead exposes a per-request cache above so no database socket is
  // shared across Worker requests.
  const client = globalForPrisma.prisma ?? createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
