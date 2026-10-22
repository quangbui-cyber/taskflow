import {
  RECAP_SUMMARY_SCHEMA,
  parseRecapSummary,
  type RecapSummary,
  type TranscriptSegment,
} from "@/lib/meetingRecap";

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
// Trần token trả về mỗi lượt, đã gồm phần "suy nghĩ" của model (Gemini tính chung và tính tiền như đầu ra).
export const RECAP_SUMMARY_MAX_OUTPUT_TOKENS = 24_576;
const OUTPUT_TOKENS_RANGE = { min: 4_096, max: 65_536 };
export const RECAP_THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
export type RecapThinkingLevel = (typeof RECAP_THINKING_LEVELS)[number];

/** Lỗi đã có câu báo tiếng Việt, hiện thẳng cho người dùng. */
export class RecapServiceError extends Error {}

export function recapModels(env: NodeJS.ProcessEnv = process.env) {
  return {
    transcribe: env.RECAP_TRANSCRIBE_MODEL?.trim() || "whisper-large-v3",
    summary: env.RECAP_SUMMARY_MODEL?.trim() || "gemini-3.8-flash",
  };
}

/**
 * Cách model viết biên bản: mức "suy nghĩ" (mặc định medium — đủ để gom chủ đề, đoán người phụ trách,
 * tính ngày hạn) và trần token trả về. Đổi được bằng biến môi trường, giá trị lạ thì dùng mặc định.
 */
export function recapSummarySettings(env: NodeJS.ProcessEnv = process.env) {
  const level = env.RECAP_SUMMARY_THINKING?.trim().toLowerCase() ?? "";
  const thinkingLevel: RecapThinkingLevel = (RECAP_THINKING_LEVELS as readonly string[]).includes(level)
    ? (level as RecapThinkingLevel)
    : "medium";
  const tokens = Number(env.RECAP_SUMMARY_MAX_OUTPUT_TOKENS);
  const maxOutputTokens =
    Number.isInteger(tokens) && tokens >= OUTPUT_TOKENS_RANGE.min && tokens <= OUTPUT_TOKENS_RANGE.max
      ? tokens
      : RECAP_SUMMARY_MAX_OUTPUT_TOKENS;
  return { thinkingLevel, maxOutputTokens };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isTimeout = (error: unknown) =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

function groqError(status: number): RecapServiceError {
  if (status === 401 || status === 403) return new RecapServiceError("Groq từ chối API key. Nhờ quản trị viên kiểm tra GROQ_API_KEY.");
  if (status === 413) return new RecapServiceError("File ghi âm quá lớn so với gói Groq hiện tại.");
  if (status === 429) return new RecapServiceError("Groq đang quá tải hoặc đã hết hạn mức. Thử lại sau ít phút.");
  if (status === 400) return new RecapServiceError("Groq không đọc được file ghi âm này. Thử đổi sang mp3 hoặc m4a.");
  return new RecapServiceError(`Groq gặp lỗi (${status}). Thử lại sau ít phút.`);
}

/**
 * Chép lời một file ghi âm Groq tự tải về qua `audioUrl` (link ký có hạn),
 * nên server không phải giữ cả file trong bộ nhớ.
 */
export async function transcribeAudioUrl({
  audioUrl,
  prompt,
  env = process.env,
}: {
  audioUrl: string;
  prompt: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ segments: TranscriptSegment[]; duration: number }> {
  const apiKey = env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new RecapServiceError("Chưa cấu hình GROQ_API_KEY.");

  for (let attempt = 1; ; attempt++) {
    const form = new FormData();
    form.append("model", recapModels(env).transcribe);
    form.append("url", audioUrl);
    form.append("language", "vi");
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    if (prompt) form.append("prompt", prompt);

    let res: Response;
    try {
      res = await fetch(GROQ_TRANSCRIBE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      // Quá thời gian chờ thì KHÔNG gọi lại: Groq có thể đã xử lý (và tính tiền) xong.
      if (isTimeout(error)) throw new RecapServiceError("Groq xử lý quá lâu. Thử lại với file ngắn hơn.");
      if (attempt < 3) {
        await wait(attempt * 3000);
        continue;
      }
      throw new RecapServiceError("Không kết nối được Groq. Thử lại sau ít phút.");
    }

    if (res.ok) {
      const data = (await res.json()) as { duration?: number; text?: string; segments?: TranscriptSegment[] };
      const segments = Array.isArray(data.segments)
        ? data.segments
        : [{ start: 0, text: String(data.text ?? "") }];
      return { segments, duration: Number(data.duration) || segments.at(-1)?.end || 0 };
    }

    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await wait(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 5000, 20_000));
      continue;
    }
    console.warn(`Groq transcription failed with status ${res.status}.`);
    throw groqError(res.status);
  }
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
};

export const RECAP_SUMMARY_TIMEOUT_MS = 150_000;
// Còn ít hơn mức này thì không gọi (lại) Gemini nữa, vì gần như chắc chắn không kịp.
const MIN_SUMMARY_ATTEMPT_MS = 20_000;
const SUMMARY_TOO_SLOW = "Gemini xử lý quá lâu. Thử bấm Viết lại sau ít phút.";

/** Viết biên bản có cấu trúc từ bản chép lời. */
export async function summarizeTranscript({
  system,
  user,
  env = process.env,
  timeoutMs = RECAP_SUMMARY_TIMEOUT_MS,
}: {
  system: string;
  user: string;
  env?: NodeJS.ProcessEnv;
  /** Tổng thời gian cho mọi lần gọi (kể cả thử lại); lượt chạy nền truyền vào phần thời gian còn lại của nó. */
  timeoutMs?: number;
}): Promise<RecapSummary> {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new RecapServiceError("Chưa cấu hình GEMINI_API_KEY.");
  const model = recapModels(env).summary;
  const { thinkingLevel, maxOutputTokens } = recapSummarySettings(env);
  // Một hạn chót chung: lần thử lại chỉ dùng phần thời gian còn lại, không được cấp lại từ đầu.
  const deadline = Date.now() + timeoutMs;

  for (let attempt = 1; ; attempt++) {
    const timeLeft = deadline - Date.now();
    if (timeLeft < MIN_SUMMARY_ATTEMPT_MS) throw new RecapServiceError(SUMMARY_TOO_SLOW);
    let res: Response;
    try {
      res = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            // Gemini 3.x bỏ qua temperature; độ cẩn thận điều chỉnh bằng mức suy nghĩ.
            thinkingConfig: { thinkingLevel },
            // Trần token trả về (đã gồm phần "suy nghĩ") để mỗi lượt có chi phí tối đa.
            maxOutputTokens,
            responseMimeType: "application/json",
            responseSchema: RECAP_SUMMARY_SCHEMA,
          },
        }),
        signal: AbortSignal.timeout(timeLeft),
      });
    } catch (error) {
      if (isTimeout(error)) throw new RecapServiceError(SUMMARY_TOO_SLOW);
      if (attempt < 3) {
        await wait(attempt * 3000);
        continue;
      }
      throw new RecapServiceError("Không kết nối được Gemini. Thử lại sau ít phút.");
    }

    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await wait(attempt * 5000);
        continue;
      }
      console.warn(`Gemini summary failed with status ${res.status}.`);
      if (res.status === 400 || res.status === 403) {
        throw new RecapServiceError("Gemini từ chối yêu cầu. Nhờ quản trị viên kiểm tra GEMINI_API_KEY và tên model.");
      }
      if (res.status === 429) throw new RecapServiceError("Gemini đang quá tải hoặc đã hết hạn mức. Thử lại sau ít phút.");
      throw new RecapServiceError(`Gemini gặp lỗi (${res.status}). Thử lại sau ít phút.`);
    }

    const data = (await res.json()) as GeminiResponse;
    const usage = data.usageMetadata;
    console.info(
      `Gemini recap (${model}, thinking ${thinkingLevel}): input ${usage?.promptTokenCount ?? "?"}, thinking ${
        usage?.thoughtsTokenCount ?? 0
      }, output ${usage?.candidatesTokenCount ?? "?"} tokens.`
    );
    const candidate = data.candidates?.[0];
    // Bỏ phần "suy nghĩ" nếu model trả kèm, chỉ đọc câu trả lời.
    const text = candidate?.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? "").join("") ?? "";
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const summary = parseRecapSummary(parsed);
    if (summary) return summary;
    if (candidate?.finishReason === "MAX_TOKENS") {
      // Gọi lại với cùng trần cũng sẽ hết token như vậy, nên báo luôn thay vì tốn thêm một lượt.
      throw new RecapServiceError(
        "AI dùng hết giới hạn token trước khi viết xong biên bản. Nhờ quản trị viên tăng RECAP_SUMMARY_MAX_OUTPUT_TOKENS hoặc giảm RECAP_SUMMARY_THINKING."
      );
    }
    if (attempt < 2) continue;
    if (data.promptFeedback?.blockReason) {
      throw new RecapServiceError("Gemini từ chối nội dung cuộc họp này. Thử viết lại hoặc tự soạn biên bản.");
    }
    throw new RecapServiceError("AI không viết được biên bản từ bản chép lời này. Thử bấm Viết lại.");
  }
}
