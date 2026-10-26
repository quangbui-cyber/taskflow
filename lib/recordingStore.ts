/**
 * Lưu tạm bản ghi âm trên chính trình duyệt (IndexedDB) trong lúc ghi, để lỡ đóng tab,
 * tải lại trang hay mất mạng thì phần đã ghi vẫn còn. Mỗi cuộc họp giữ tối đa một bản ghi.
 * Mọi lỗi đều được nuốt: không lưu được thì vẫn ghi âm bình thường trong bộ nhớ.
 */

const DB_NAME = "taskflow-recordings";
const DB_VERSION = 1;
const SESSIONS = "sessions";
const CHUNKS = "chunks";

export type RecordingMeta = {
  meetingId: string;
  mimeType: string;
  startedAt: number;
  durationMs: number;
  updatedAt: number;
};

type ChunkRow = { meetingId: string; seq: number; data: Blob };

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: "meetingId" });
        if (!db.objectStoreNames.contains(CHUNKS)) {
          const chunks = db.createObjectStore(CHUNKS, { keyPath: ["meetingId", "seq"] });
          chunks.createIndex("byMeeting", "meetingId");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

/** Lưu một đoạn ghi và cập nhật thông tin bản ghi trong cùng một giao dịch. */
export async function saveRecordingChunk(meta: RecordingMeta, seq: number, data: Blob): Promise<boolean> {
  try {
    const db = await openDb();
    if (!db) return false;
    const tx = db.transaction([SESSIONS, CHUNKS], "readwrite");
    tx.objectStore(SESSIONS).put(meta);
    tx.objectStore(CHUNKS).put({ meetingId: meta.meetingId, seq, data } satisfies ChunkRow);
    return await done(tx);
  } catch {
    return false;
  }
}

/** Cập nhật thời lượng (ví dụ lúc tạm dừng/dừng) mà không thêm đoạn mới. */
export async function saveRecordingMeta(meta: RecordingMeta): Promise<boolean> {
  try {
    const db = await openDb();
    if (!db) return false;
    const tx = db.transaction(SESSIONS, "readwrite");
    tx.objectStore(SESSIONS).put(meta);
    return await done(tx);
  } catch {
    return false;
  }
}

/** Bản ghi đã lưu của cuộc họp (ghép các đoạn theo thứ tự), hoặc null nếu không có. */
export async function loadRecording(
  meetingId: string
): Promise<{ meta: RecordingMeta; chunks: Blob[] } | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const tx = db.transaction([SESSIONS, CHUNKS], "readonly");
    const metaRequest = tx.objectStore(SESSIONS).get(meetingId);
    const chunkRequest = tx.objectStore(CHUNKS).index("byMeeting").getAll(meetingId);
    const ok = await done(tx);
    if (!ok) return null;
    const meta = metaRequest.result as RecordingMeta | undefined;
    const rows = (chunkRequest.result as ChunkRow[] | undefined) ?? [];
    if (!meta || rows.length === 0) return null;
    rows.sort((a, b) => a.seq - b.seq);
    return { meta, chunks: rows.map((row) => row.data) };
  } catch {
    return null;
  }
}

export async function clearRecording(meetingId: string): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction([SESSIONS, CHUNKS], "readwrite");
    tx.objectStore(SESSIONS).delete(meetingId);
    tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([meetingId, -Infinity], [meetingId, Infinity]));
    await done(tx);
  } catch {
    // Không xoá được thì lần sau mở trang vẫn thấy bản ghi và có thể xoá tay.
  }
}
