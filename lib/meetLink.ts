/**
 * Tách và chuẩn hoá mã phòng họp Google Meet ("abc-defg-hij").
 * Google Meet dùng mã gồm 10 chữ cái: 3 - 4 - 3 ký tự (ví dụ: "vtu-xyza-qwe").
 */

/** Chuẩn hoá chuỗi mã về dạng 3-4-3 chữ cái thường: "abc-defg-hij" */
export function normalizeMeetCode(raw: string): string | null {
  const clean = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (clean.length === 10) {
    return `${clean.slice(0, 3)}-${clean.slice(3, 7)}-${clean.slice(7)}`;
  }
  return null;
}

/**
 * Tách mã phòng Meet từ URL đầy đủ, link rút gọn, văn bản lời mời hoặc mã thô.
 * Trả về mã chuẩn "abc-defg-hij" hoặc null nếu không phải Google Meet.
 */
export function parseMeetCode(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text) return null;

  // 1. Link dạng meet.google.com/[lookup/]<code hoặc slug>
  const urlPattern = /(?:https?:\/\/)?meet\.google\.com\/(?:lookup\/)?([a-zA-Z0-9_-]+)/i;
  const urlMatch = urlPattern.exec(text);
  if (urlMatch) {
    const rawCandidate = urlMatch[1];
    // Nếu có dạng xxx-xxxx-xxx
    const hyphenPattern = /^([a-zA-Z]{3})-([a-zA-Z]{4})-([a-zA-Z]{3})$/;
    const hyphenMatch = hyphenPattern.exec(rawCandidate);
    if (hyphenMatch) {
      return `${hyphenMatch[1]}-${hyphenMatch[2]}-${hyphenMatch[3]}`.toLowerCase();
    }
    // Nếu là 10 ký tự liền
    const normalized = normalizeMeetCode(rawCandidate);
    if (normalized) return normalized;
  }

  // 2. Chuỗi có mã phòng đứng độc lập trong văn bản (ví dụ "Mã cuộc họp: abc-defg-hij")
  const standalonePattern = /\b([a-zA-Z]{3})-([a-zA-Z]{4})-([a-zA-Z]{3})\b/;
  const standaloneMatch = standalonePattern.exec(text);
  if (standaloneMatch) {
    return `${standaloneMatch[1]}-${standaloneMatch[2]}-${standaloneMatch[3]}`.toLowerCase();
  }

  // 3. Chuỗi thô đúng 10 ký tự (ví dụ người dùng dán "abcdefghij")
  if (/^[a-zA-Z]{10}$/.test(text)) {
    return normalizeMeetCode(text);
  }

  return null;
}

/** Tạo link Google Meet chuẩn từ mã phòng */
export function formatMeetUrl(meetCode: string): string {
  const normalized = normalizeMeetCode(meetCode) ?? meetCode.trim().toLowerCase();
  return `https://meet.google.com/${normalized}`;
}
