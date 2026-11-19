import { cleanRecipient, normalizeEmail, isValidEmail, type RecipientDraft } from "@/lib/customerMail";
import { recapModels } from "@/lib/meetingRecapAi";

// Đọc danh sách người nhận: CSV/XLSX đọc thẳng bằng code; PDF, ảnh và chữ dán vào
// (hoặc bảng có tiêu đề cột lộn xộn) thì nhờ Gemini trích thành bảng có cấu trúc.

export class MailImportError extends Error {}

export type ImportKind = "csv" | "xlsx" | "pdf" | "image" | "text";

/** Mỗi file gửi lên tối đa ~4 MB (giới hạn thân request của Vercel là 4,5 MB). */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
export const MAX_PASTE_CHARS = 60_000;

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", heic: "image/heic", heif: "image/heif",
};

export function importKind(fileName: string, mimeType: string): { kind: ImportKind; mimeType: string } | null {
  const extension = fileName.toLowerCase().split(".").at(-1) ?? "";
  if (extension === "csv" || mimeType === "text/csv") return { kind: "csv", mimeType: "text/csv" };
  if (extension === "xlsx" || mimeType.includes("spreadsheetml")) {
    return { kind: "xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  }
  if (extension === "pdf" || mimeType === "application/pdf") return { kind: "pdf", mimeType: "application/pdf" };
  if (IMAGE_TYPES[extension]) return { kind: "image", mimeType: IMAGE_TYPES[extension] };
  if (mimeType.startsWith("image/") && Object.values(IMAGE_TYPES).includes(mimeType)) return { kind: "image", mimeType };
  if (extension === "txt" || mimeType === "text/plain") return { kind: "text", mimeType: "text/plain" };
  return null;
}

// ---------- CSV / XLSX ----------

/** Tách CSV có ngoặc kép; tự nhận dấu phân cách , ; hoặc tab theo dòng đầu. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((delimiter) => [delimiter, firstLine.split(delimiter).length] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((cells) => cells.map((value) => value.normalize("NFC").trim())).filter((cells) => cells.some(Boolean));
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.richText)) return (record.richText as { text?: string }[]).map((part) => part.text ?? "").join("");
    if (typeof record.text === "string") return record.text;
    if (typeof record.hyperlink === "string") return record.hyperlink;
    if ("result" in record) return cellText(record.result);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return "";
  }
  return String(value);
}

/** Đọc mọi sheet có dữ liệu của file .xlsx thành bảng chữ. */
export async function readXlsxRows(data: Buffer): Promise<string[][][]> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  } catch {
    throw new MailImportError("Không mở được file Excel này. Thử lưu lại dạng .xlsx hoặc .csv.");
  }
  const sheets: string[][][] = [];
  for (const sheet of workbook.worksheets) {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      const cells = values.map((value) => cellText(value).normalize("NFC").replace(/\s+/g, " ").trim());
      if (cells.some(Boolean)) rows.push(cells);
    });
    if (rows.length) sheets.push(rows);
  }
  return sheets;
}

const headerKey = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]/g, "");

type Column = "full_name" | "email" | "call_name" | "salutation" | "group" | "note";

const HEADER_ALIASES: Record<Column, string[]> = {
  email: ["email", "mail", "emailaddress", "diachiemail", "thudientu", "gmail"],
  call_name: ["tengoi", "tenthuonggoi", "biendanh", "nickname", "callname", "tengoitrongthu"],
  salutation: ["xungho", "danhxung", "salutation", "title", "anhchi", "danhhieu"],
  full_name: ["hoten", "hovaten", "ten", "fullname", "name", "tennhanvien", "hotennhanvien", "khachmoi", "thanhvien"],
  group: ["nhom", "team", "doi", "phongban", "group", "bophan", "nha", "giatoc"],
  note: ["ghichu", "note", "notes", "chucvu", "chucdanh", "position"],
};

function matchHeader(cell: string): Column | null {
  const key = headerKey(cell);
  if (!key) return null;
  for (const column of Object.keys(HEADER_ALIASES) as Column[]) {
    if (HEADER_ALIASES[column].includes(key)) return column;
  }
  return null;
}

/**
 * Tìm dòng tiêu đề và cột tên/email bằng chữ tiêu đề. Không chắc chắn (không có cột email
 * hoặc cột tên) thì trả null để nhờ Gemini dò cột.
 */
export function mapTable(rows: string[][], source: string): RecipientDraft[] | null {
  for (let headerIndex = 0; headerIndex < Math.min(rows.length, 10); headerIndex++) {
    const columns = new Map<Column, number>();
    rows[headerIndex].forEach((cell, index) => {
      const column = matchHeader(cell);
      if (column && !columns.has(column)) columns.set(column, index);
    });
    if (!columns.has("email") || !columns.has("full_name")) continue;
    const body = rows.slice(headerIndex + 1);
    const emailColumn = columns.get("email")!;
    const filled = body.filter((row) => row[emailColumn]);
    // Cột "email" phải thật sự chứa email, phòng file đặt tiêu đề nhầm.
    if (filled.length && filled.filter((row) => isValidEmail(normalizeEmail(row[emailColumn]))).length < filled.length / 2) {
      return null;
    }
    const drafts: RecipientDraft[] = [];
    for (const row of body) {
      const get = (column: Column) => (columns.has(column) ? row[columns.get(column)!] ?? "" : "");
      const draft = cleanRecipient(
        {
          full_name: get("full_name"),
          email: get("email"),
          call_name: get("call_name"),
          salutation: get("salutation"),
          group: get("group"),
          note: get("note"),
        },
        source
      );
      if (draft) drafts.push({ ...draft, confidence: null });
    }
    return drafts;
  }
  return null;
}

export function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")).join("\n");
}

// ---------- Gemini ----------

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export const EXTRACT_SCHEMA = {
  type: "OBJECT",
  properties: {
    people: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          full_name: { type: "STRING" },
          email: { type: "STRING", nullable: true },
          call_name: { type: "STRING", nullable: true },
          salutation: { type: "STRING", enum: ["anh", "chi", "ban"], nullable: true },
          group: { type: "STRING", nullable: true },
          note: { type: "STRING", nullable: true },
          confidence: { type: "NUMBER" },
        },
        required: ["full_name", "confidence"],
      },
    },
    summary: { type: "STRING" },
  },
  required: ["people", "summary"],
} as const;

export const EXTRACT_PROMPT = [
  "Đây là danh sách người nhận email. Trích từng người thành một dòng.",
  "Giữ nguyên chính tả tiếng Việt của họ tên.",
  "`call_name` là tên gọi thường dùng (thường là chữ cuối của họ tên).",
  'Chỉ điền `salutation` khi danh sách ghi rõ (ví dụ "Anh", "Chị", "Mr", "Ms"). Không đoán anh hay chị từ tên người.',
  "Chép email đúng từng ký tự; chú ý các ký tự dễ nhầm như l và 1, rn và m, 0 và o.",
  "Nếu không đọc rõ email thì để null và giảm `confidence`.",
  "`confidence` từ 0 đến 1: mức chắc chắn rằng họ tên và email của dòng đó đọc đúng.",
  "`summary` tóm tắt tổng số người, các nhóm, và các dòng có vấn đề. Viết tiếng Việt, ngắn gọn.",
].join("\n");

export function mailImportModel(env: NodeJS.ProcessEnv = process.env) {
  return env.MAIL_IMPORT_MODEL?.trim() || recapModels(env).summary;
}

export function isMailImportAiConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.GEMINI_API_KEY?.trim());
}

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export type ExtractResult = { people: RecipientDraft[]; summary: string };

export function parseExtraction(value: unknown, source: string): ExtractResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.people)) return null;
  const people = record.people
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const draft = cleanRecipient(item, source);
      if (!draft) return null;
      // Email Gemini đọc ra mà sai định dạng thì cũng coi là chưa chắc.
      if (draft.email && !isValidEmail(draft.email)) draft.confidence = Math.min(draft.confidence ?? 0.5, 0.5);
      if (draft.confidence === null) draft.confidence = 0.5;
      return draft;
    })
    .filter((draft): draft is RecipientDraft => draft !== null);
  const summary = typeof record.summary === "string" ? record.summary.trim().slice(0, 1000) : "";
  return { people, summary };
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

/** Gọi Gemini (từ máy chủ, API key không ra trình duyệt) với đầu ra JSON cố định. */
export async function extractWithGemini({
  parts,
  source,
  env = process.env,
  timeoutMs = 50_000,
  fetchImpl = fetch,
}: {
  parts: GeminiPart[];
  source: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<ExtractResult> {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new MailImportError("Chưa cấu hình GEMINI_API_KEY nên chưa đọc được PDF, ảnh hay chữ dán.");
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; ; attempt++) {
    const timeLeft = deadline - Date.now();
    if (timeLeft < 5_000) throw new MailImportError("Gemini đọc danh sách quá lâu. Thử lại hoặc chia nhỏ file.");
    let res: Response;
    try {
      res = await fetchImpl(`${GEMINI_BASE_URL}/${encodeURIComponent(mailImportModel(env))}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: EXTRACT_PROMPT }] },
          contents: [{ role: "user", parts }],
          generationConfig: {
            thinkingConfig: { thinkingLevel: "low" },
            maxOutputTokens: 32_768,
            responseMimeType: "application/json",
            responseSchema: EXTRACT_SCHEMA,
          },
        }),
        signal: AbortSignal.timeout(timeLeft),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new MailImportError("Gemini đọc danh sách quá lâu. Thử lại hoặc chia nhỏ file.");
      }
      if (attempt < 2) continue;
      throw new MailImportError("Không kết nối được Gemini. Thử lại sau ít phút.");
    }
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }
      console.warn(`Gemini mail import failed with status ${res.status}.`);
      if (res.status === 400 || res.status === 403) {
        throw new MailImportError("Gemini từ chối file này. Kiểm tra định dạng file, GEMINI_API_KEY và tên model.");
      }
      if (res.status === 429) throw new MailImportError("Gemini đang quá tải hoặc đã hết hạn mức. Thử lại sau ít phút.");
      throw new MailImportError(`Gemini gặp lỗi (${res.status}). Thử lại sau ít phút.`);
    }
    const data = (await res.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? "").join("") ?? "";
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const result = parseExtraction(parsed, source);
    if (result) return result;
    if (attempt < 2 && candidate?.finishReason !== "MAX_TOKENS") continue;
    if (data.promptFeedback?.blockReason) throw new MailImportError("Gemini từ chối đọc nội dung này.");
    throw new MailImportError("Gemini không đọc được danh sách từ file này. Thử ảnh rõ hơn hoặc file khác.");
  }
}

/** Đọc một file (hoặc chữ dán) thành các dòng người nhận. */
export async function importRecipients(
  input: { kind: ImportKind; mimeType: string; data: Buffer; source: string },
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}
): Promise<ExtractResult & { usedAi: boolean }> {
  const { kind, data, source } = input;
  if (kind === "csv" || kind === "xlsx") {
    const sheets = kind === "csv" ? [parseCsv(data.toString("utf8"))] : await readXlsxRows(data);
    const direct = sheets.map((rows) => mapTable(rows, source));
    if (sheets.length && direct.every((rows) => rows !== null)) {
      const people = direct.flat() as RecipientDraft[];
      return { people, summary: `${people.length} người đọc từ ${source}.`, usedAi: false };
    }
    if (!sheets.length) throw new MailImportError(`${source} không có dữ liệu.`);
    // Tiêu đề cột lộn xộn: gửi bảng dạng CSV để Gemini dò cột.
    const csv = sheets.map(rowsToCsv).join("\n\n").slice(0, MAX_PASTE_CHARS * 2);
    const result = await extractWithGemini({ parts: [{ text: csv }], source, ...options });
    return { ...result, usedAi: true };
  }
  if (kind === "text") {
    const text = data.toString("utf8").slice(0, MAX_PASTE_CHARS);
    const result = await extractWithGemini({ parts: [{ text }], source, ...options });
    return { ...result, usedAi: true };
  }
  const result = await extractWithGemini({
    parts: [{ inlineData: { mimeType: input.mimeType, data: data.toString("base64") } }, { text: "Trích danh sách người nhận từ file đính kèm." }],
    source,
    ...options,
  });
  return { ...result, usedAi: true };
}
