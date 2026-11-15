// Gửi thư cho khách: phần logic thuần (không đụng database), để dùng chung cho
// server, giao diện và test. Biến trong thư: {{ten_goi}}, {{xung_ho}}, {{Xung_ho}},
// {{ho_ten}}, {{nhom}}.

export const SALUTATIONS = ["anh", "chi", "ban"] as const;
export type Salutation = (typeof SALUTATIONS)[number];

export const SALUTATION_LABELS: Record<Salutation, string> = { anh: "Anh", chi: "Chị", ban: "Bạn" };

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "done"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Nháp",
  scheduled: "Đã hẹn giờ",
  sending: "Đang gửi",
  done: "Đã gửi xong",
};

export const RECIPIENT_STATUS_LABELS: Record<string, string> = {
  pending: "Chờ gửi",
  sending: "Đang gửi",
  sent: "Đã gửi",
  failed: "Lỗi",
};

/** Dưới mức này thì dòng do Gemini đọc được tô vàng, người duyệt phải xem lại. */
export const LOW_CONFIDENCE = 0.8;
/** Số thư mỗi lượt cron (mỗi thư cách nhau ~1,5 giây để Gmail không khoá tạm thời). */
export const SEND_BATCH_SIZE = 20;
export const SEND_GAP_MS = 1500;
/** Thử lại tối đa bấy nhiêu lần với lỗi tạm thời (mạng, giới hạn tốc độ). */
export const MAX_SEND_ATTEMPTS = 3;
/** Dòng kẹt ở "sending" lâu hơn mức này (lượt gửi bị ngắt giữa chừng) thì đánh lỗi, không tự gửi lại. */
export const STUCK_SENDING_MS = 10 * 60 * 1000;
export const MAX_RECIPIENTS = 2000;

export function isSalutation(value: unknown): value is Salutation {
  return typeof value === "string" && (SALUTATIONS as readonly string[]).includes(value);
}

const stripMarks = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Đọc xưng hô ghi trong danh sách ("Anh", "Chị", "Mr", "Ms", "A.", "C."); không đoán từ tên. */
export function parseSalutation(value: unknown): Salutation | null {
  if (typeof value !== "string") return null;
  const key = stripMarks(value).replace(/[^a-z]/g, "");
  if (!key) return null;
  if (["anh", "a", "mr", "mister", "ong"].includes(key)) return "anh";
  if (["chi", "c", "ms", "mrs", "miss", "ba", "co"].includes(key)) return "chi";
  if (["ban", "b", "em"].includes(key)) return "ban";
  return null;
}

const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Email chữ thường, bỏ khoảng trắng và tiền tố "mailto:"; chuỗi rỗng thành null. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.replace(/^mailto:/i, "").replace(/\s+/g, "").toLowerCase();
  return email || null;
}

export function isValidEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.length <= 254 && EMAIL_PATTERN.test(email));
}

const oneLine = (value: unknown, max = 200) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Tên gọi mặc định: chữ cuối của họ tên ("Vũ Nguyễn Tuyết Nhung" → "Nhung"). */
export function defaultCallName(fullName: string): string {
  return oneLine(fullName).split(" ").at(-1) ?? "";
}

export type RecipientDraft = {
  fullName: string;
  email: string | null;
  callName: string | null;
  salutation: Salutation | null;
  group: string | null;
  note: string | null;
  source: string | null;
  confidence: number | null;
};

/** Làm sạch một dòng đọc được từ file hay từ Gemini; dòng không có cả tên lẫn email thì bỏ. */
export function cleanRecipient(raw: Record<string, unknown>, source: string | null): RecipientDraft | null {
  const email = normalizeEmail(raw.email);
  let fullName = oneLine(raw.full_name ?? raw.fullName);
  if (!fullName && !email) return null;
  if (!fullName && email) fullName = email.split("@")[0];
  const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
    ? Math.min(1, Math.max(0, raw.confidence))
    : null;
  return {
    fullName,
    email,
    callName: oneLine(raw.call_name ?? raw.callName, 60) || defaultCallName(fullName) || null,
    salutation: isSalutation(raw.salutation) ? raw.salutation : parseSalutation(raw.salutation),
    group: oneLine(raw.group, 120) || null,
    note: oneLine(raw.note, 300) || null,
    source,
    confidence,
  };
}

/**
 * Gộp các dòng trùng email (không phân biệt hoa thường): giữ dòng đầu, điền thêm phần
 * còn trống từ dòng sau. Dòng chưa có email giữ nguyên để người duyệt điền.
 */
export function mergeDuplicates(rows: RecipientDraft[]): { rows: RecipientDraft[]; merged: number } {
  const byEmail = new Map<string, RecipientDraft>();
  const result: RecipientDraft[] = [];
  let merged = 0;
  for (const row of rows) {
    if (!row.email) {
      result.push(row);
      continue;
    }
    const existing = byEmail.get(row.email);
    if (!existing) {
      const copy = { ...row };
      byEmail.set(row.email, copy);
      result.push(copy);
      continue;
    }
    merged += 1;
    existing.callName ??= row.callName;
    existing.salutation ??= row.salutation;
    existing.group ??= row.group;
    existing.note ??= row.note;
    if (row.confidence !== null) {
      existing.confidence = Math.max(existing.confidence ?? 0, row.confidence);
    }
  }
  return { rows: result, merged };
}

export type RecipientLike = {
  fullName: string;
  email: string | null;
  callName: string | null;
  salutation: string | null;
  group: string | null;
  confidence: number | null;
  reviewed: boolean;
};

export type RecipientIssue = "missing-email" | "invalid-email" | "duplicate-email" | "missing-salutation" | "missing-name" | "low-confidence";

export const ISSUE_LABELS: Record<RecipientIssue, string> = {
  "missing-email": "Thiếu email",
  "invalid-email": "Email sai định dạng",
  "duplicate-email": "Trùng email",
  "missing-salutation": "Chưa chọn xưng hô",
  "missing-name": "Thiếu tên gọi",
  "low-confidence": "Cần xem lại",
};

/** Các vấn đề của từng dòng: lỗi (đỏ) chặn gửi, "low-confidence" (vàng) cũng chặn tới khi đã xem. */
export function recipientIssues(row: RecipientLike, duplicates?: Set<string>): RecipientIssue[] {
  const issues: RecipientIssue[] = [];
  if (!row.email) issues.push("missing-email");
  else if (!isValidEmail(row.email)) issues.push("invalid-email");
  else if (duplicates?.has(row.email)) issues.push("duplicate-email");
  if (!isSalutation(row.salutation)) issues.push("missing-salutation");
  if (!oneLine(row.callName)) issues.push("missing-name");
  if (!row.reviewed && row.confidence !== null && row.confidence < LOW_CONFIDENCE) issues.push("low-confidence");
  return issues;
}

export function duplicateEmails(rows: { email: string | null }[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    if (!row.email) continue;
    if (seen.has(row.email)) duplicates.add(row.email);
    seen.add(row.email);
  }
  return duplicates;
}

export type Readiness = {
  total: number;
  blocked: number;
  bySalutation: Record<Salutation, number>;
  ready: boolean;
};

/** Chỉ gửi được khi có người nhận và không còn dòng đỏ hay vàng. */
export function campaignReadiness(rows: RecipientLike[]): Readiness {
  const duplicates = duplicateEmails(rows);
  const bySalutation: Record<Salutation, number> = { anh: 0, chi: 0, ban: 0 };
  let blocked = 0;
  for (const row of rows) {
    if (recipientIssues(row, duplicates).length) blocked += 1;
    if (isSalutation(row.salutation)) bySalutation[row.salutation] += 1;
  }
  return { total: rows.length, blocked, bySalutation, ready: rows.length > 0 && blocked === 0 };
}

// ---------- Biến trong thư ----------

export type MailVariables = Record<"ten_goi" | "xung_ho" | "Xung_ho" | "ho_ten" | "nhom", string>;

export const VARIABLE_TOKENS = ["{{Xung_ho}}", "{{xung_ho}}", "{{ten_goi}}", "{{ho_ten}}", "{{nhom}}"] as const;

export function recipientVariables(row: {
  fullName: string;
  callName: string | null;
  salutation: string | null;
  group: string | null;
}): MailVariables {
  const salutation = isSalutation(row.salutation) ? row.salutation : null;
  const lower = salutation === "anh" ? "anh" : salutation === "chi" ? "chị" : "bạn";
  return {
    ten_goi: oneLine(row.callName) || defaultCallName(row.fullName),
    xung_ho: lower,
    // "Bạn" ở lời chào thì bỏ trống để ra "Nhung thân mến,".
    Xung_ho: salutation === "ban" ? "" : lower.charAt(0).toUpperCase() + lower.slice(1),
    ho_ten: oneLine(row.fullName),
    nhom: oneLine(row.group),
  };
}

/** Thay biến, rồi dọn khoảng trắng thừa khi một biến rỗng và viết hoa chữ đầu dòng. */
export function fillTemplate(template: string, variables: MailVariables): string {
  const filled = template.replace(/\{\{\s*(ten_goi|xung_ho|Xung_ho|ho_ten|nhom)\s*\}\}/g, (_match, key: keyof MailVariables) => variables[key]);
  return filled
    .split("\n")
    .map((line) => {
      const tidy = line.replace(/[ \t]{2,}/g, " ").replace(/ +([,.!?;:])/g, "$1").trim();
      return tidy.charAt(0).toUpperCase() + tidy.slice(1);
    })
    .join("\n");
}

/** Biến lạ (gõ sai tên) để báo cho người soạn thư. */
export function unknownVariables(text: string): string[] {
  const known = new Set(["ten_goi", "xung_ho", "Xung_ho", "ho_ten", "nhom"]);
  const found = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
    if (!known.has(match[1])) found.add(`{{${match[1]}}}`);
  }
  return [...found];
}

export function splitParagraphs(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

// ---------- Giờ Việt Nam ----------

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** "2026-11-15T19:00" (giờ Việt Nam, từ ô datetime-local) → Date UTC. */
export function parseVietnamDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, h, min) - VN_OFFSET_MS);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Date → "2026-11-15T19:00" theo giờ Việt Nam, cho ô datetime-local. */
export function toVietnamDateTimeInput(date: Date): string {
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().slice(0, 16);
}

export function formatVietnamDateTime(date: Date): string {
  const local = new Date(date.getTime() + VN_OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} ${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()}`;
}
