import {
  RECAP_SUMMARY_SCHEMA,
  parseRecapSummary,
  type RecapSummary,
  type TranscriptSegment,
} from "@/lib/meetingRecap";

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** Lỗi đã có câu báo tiếng Việt, hiện thẳng cho người dùng. */
export class RecapServiceError extends Error {}

export function recapModels(env: NodeJS.ProcessEnv = process.env) {
  return {
    transcribe: env.RECAP_TRANSCRIBE_MODEL?.trim() || "whisper-large-v3",
    summary: env.RECAP_SUMMARY_MODEL?.trim() || "gemini-3.1-flash-lite",
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    } catch {
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
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

/** Viết biên bản có cấu trúc từ bản chép lời. */
export async function summarizeTranscript({
  system,
  user,
  env = process.env,
}: {
  system: string;
  user: string;
  env?: NodeJS.ProcessEnv;
}): Promise<RecapSummary> {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new RecapServiceError("Chưa cấu hình GEMINI_API_KEY.");
  const model = recapModels(env).summary;

  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: RECAP_SUMMARY_SCHEMA,
          },
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
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
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const summary = parseRecapSummary(parsed);
    if (summary) return summary;
    if (attempt < 2) continue;
    if (data.promptFeedback?.blockReason) {
      throw new RecapServiceError("Gemini từ chối nội dung cuộc họp này. Thử viết lại hoặc tự soạn biên bản.");
    }
    throw new RecapServiceError("AI không viết được biên bản từ bản chép lời này. Thử bấm Viết lại.");
  }
}
