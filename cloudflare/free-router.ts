type Fetcher = { fetch(request: Request): Promise<Response> };
type DurableObjectId = unknown;
type DurableObjectNamespace = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): Fetcher;
};

export type FreeRouterEnv = {
  EVIDENCE_OBJECTS: DurableObjectNamespace;
  LEGACY: Fetcher;
};

const EVIDENCE_PATH = /^\/api\/projects\/([^/]+)\/costflow\/evidence\/([^/]+)(?:\/(preview))?\/?$/;
const PAIRED_DATA_PATH = /^\/api\/projects\/([^/]+)\/costflow\/paired-data\/?$/;
const PAIRED_SAVE_PATH = /^\/api\/projects\/([^/]+)\/costflow\/paired-save\/?$/;

export function evidencePath(url: URL) {
  const match = EVIDENCE_PATH.exec(url.pathname);
  if (!match) return null;
  try {
    return {
      projectId: decodeURIComponent(match[1]),
      evidenceId: decodeURIComponent(match[2]),
      preview: match[3] === "preview",
    };
  } catch {
    return null;
  }
}

export function pairedDataPath(url: URL) {
  const match = PAIRED_DATA_PATH.exec(url.pathname);
  if (!match) return null;
  try { return { projectId: decodeURIComponent(match[1]) }; } catch { return null; }
}

export function pairedSavePath(url: URL) {
  const match = PAIRED_SAVE_PATH.exec(url.pathname);
  if (!match) return null;
  try { return { projectId: decodeURIComponent(match[1]) }; } catch { return null; }
}

export function createFreeRouter(env: FreeRouterEnv) {
  return {
    async fetch(request: Request) {
      const path = evidencePath(new URL(request.url));
      const pairedPath = pairedDataPath(new URL(request.url));
      const pairedSave = pairedSavePath(new URL(request.url));
      const isEvidenceRequest = !!path && (
        request.method === "GET" || (request.method === "POST" && path.evidenceId === "upload" && !path.preview)
      );
      const projectId = isEvidenceRequest
        ? path?.projectId
        : request.method === "GET"
          ? pairedPath?.projectId
          : request.method === "POST"
            ? pairedSave?.projectId
            : undefined;
      if (projectId) {
        const id = env.EVIDENCE_OBJECTS.idFromName(projectId);
        return env.EVIDENCE_OBJECTS.get(id).fetch(request);
      }
      return env.LEGACY.fetch(request);
    },
  };
}

const worker = {
  fetch(request: Request, env: FreeRouterEnv) {
    return createFreeRouter(env).fetch(request);
  },
};

export default worker;
