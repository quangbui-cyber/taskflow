import assert from "node:assert/strict";
import { test } from "node:test";
import { recapAudioContentType, recapAudioPathname } from "../lib/meetingRecap";
import {
  AUTO_SUBMIT_MIN_MS,
  OVERTIME_EXTEND_MS,
  OVERTIME_GRACE_MS,
  SILENCE_STOP_MS,
  SILENCE_WARN_MS,
  SPEECH_RMS_THRESHOLD,
  autoStopMessage,
  chunksToKeep,
  autoStopState,
  initialAutoStopEndsAt,
  rms,
  NO_TAB_AUDIO_MESSAGE,
  RECORDING_BITS_PER_SECOND,
  canRecordTabAudio,
  displayCaptureErrorMessage,
  microphoneErrorMessage,
  pickRecordingMimeType,
  recordingFileName,
  recordingFileType,
  shouldAutoSubmitRecording,
} from "../lib/meetingRecorder";
import { formatLimit, friendlyUploadError } from "../lib/recapUploadClient";

test("the recorder prefers Opus/WebM, falls back to MP4 for Safari, and survives odd browsers", () => {
  assert.equal(pickRecordingMimeType(() => true), "audio/webm;codecs=opus");
  assert.equal(pickRecordingMimeType((type) => type.startsWith("audio/mp4")), "audio/mp4;codecs=mp4a.40.2");
  assert.equal(pickRecordingMimeType((type) => type === "audio/mp4"), "audio/mp4");
  assert.equal(pickRecordingMimeType(() => false), null);
  assert.equal(
    pickRecordingMimeType((type) => {
      if (type.includes("webm")) throw new Error("unsupported");
      return type === "audio/mp4";
    }),
    "audio/mp4"
  );
});

test("recordings get a file type and name that the upload pipeline accepts", () => {
  assert.deepEqual(recordingFileType("audio/webm;codecs=opus"), { type: "audio/webm", extension: ".webm" });
  assert.deepEqual(recordingFileType("audio/mp4;codecs=mp4a.40.2"), { type: "audio/mp4", extension: ".m4a" });
  assert.deepEqual(recordingFileType("audio/ogg;codecs=opus"), { type: "audio/ogg", extension: ".ogg" });

  // 07:05 UTC = 14:05 giờ Việt Nam
  const name = recordingFileName("audio/webm;codecs=opus", new Date("2026-10-22T07:05:00Z"));
  assert.equal(name, "ghi-am-2026-10-22-1405.webm");
  assert.equal(recordingFileName("audio/mp4", new Date("2026-10-22T17:30:00Z")), "ghi-am-2026-10-23-0030.m4a");

  for (const mime of ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]) {
    const file = recordingFileName(mime, new Date());
    assert.equal(recapAudioContentType(file), recordingFileType(mime).type);
    assert.ok(recapAudioPathname("cm123abc", file));
  }
});

test("an hour of recording stays far below the 100 MB upload limit", () => {
  const bytesPerHour = (RECORDING_BITS_PER_SECOND / 8) * 3600;
  assert.ok(bytesPerHour < 15 * 1024 * 1024);
});

test("microphone problems are explained in plain Vietnamese", () => {
  const err = (name: string) => Object.assign(new Error("x"), { name });
  assert.match(microphoneErrorMessage(err("NotAllowedError")), /cho phép Micro/);
  assert.match(microphoneErrorMessage(err("NotFoundError")), /Không tìm thấy micro/);
  assert.match(microphoneErrorMessage(err("NotReadableError")), /ứng dụng khác/);
  assert.match(microphoneErrorMessage("weird"), /Tải lại trang/);
});

test("upload helpers format limits and soften library errors", () => {
  assert.equal(formatLimit(180), "3 giờ");
  assert.equal(formatLimit(90), "90 phút");
  assert.equal(friendlyUploadError(new Error("Vercel Blob: Failed to  retrieve the client token")), "Chưa tải được file lên lúc này. Tải lại trang rồi thử lại.");
  assert.equal(friendlyUploadError(new Error("Cuộc họp chưa bắt đầu.")), "Cuộc họp chưa bắt đầu.");
  assert.equal(friendlyUploadError(null), "Không tải được file lên.");
});

test("online meetings (tab audio) are offered only on desktop Chrome and Edge", () => {
  const chromeMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  const edgeWin = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
  const safariMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15";
  const firefox = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0";
  const chromeAndroid = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
  const chromeIphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1";

  assert.equal(canRecordTabAudio(chromeMac, true), true);
  assert.equal(canRecordTabAudio(edgeWin, true), true);
  assert.equal(canRecordTabAudio(chromeMac, false), false);
  assert.equal(canRecordTabAudio(safariMac, true), false);
  assert.equal(canRecordTabAudio(firefox, true), false);
  assert.equal(canRecordTabAudio(chromeAndroid, true), false);
  assert.equal(canRecordTabAudio(chromeIphone, true), false);
});

test("tab sharing problems are explained in plain Vietnamese", () => {
  const err = (name: string) => Object.assign(new Error("x"), { name });
  assert.match(displayCaptureErrorMessage(err("NotAllowedError")), /chưa chọn tab cuộc họp/);
  assert.match(displayCaptureErrorMessage(err("NotSupportedError")), /Chrome hoặc Edge/);
  assert.match(displayCaptureErrorMessage(undefined), /Tải lại trang/);
  assert.match(NO_TAB_AUDIO_MESSAGE, /Chia sẻ âm thanh của tab/);
});

test("closing the meeting tab creates the recap automatically, except for accidental short recordings", () => {
  assert.equal(AUTO_SUBMIT_MIN_MS, 30_000);
  assert.equal(shouldAutoSubmitRecording(29_999), false);
  assert.equal(shouldAutoSubmitRecording(30_000), true);
  assert.equal(shouldAutoSubmitRecording(45 * 60 * 1000), true);
});

test("in-person recordings stop themselves 10 minutes after the scheduled end", () => {
  const end = 1_000_000;
  const base = { endsAtMs: end, lastSoundAtMs: end, paused: false };
  assert.deepEqual(autoStopState({ ...base, nowMs: end - 1 }), { stop: null, overtimeLeftMs: null, silenceLeftMs: null });
  assert.equal(autoStopState({ ...base, nowMs: end, lastSoundAtMs: end }).overtimeLeftMs, OVERTIME_GRACE_MS);
  assert.equal(autoStopState({ ...base, nowMs: end + 4 * 60_000, lastSoundAtMs: end + 4 * 60_000 }).overtimeLeftMs, 6 * 60_000);
  assert.equal(autoStopState({ ...base, nowMs: end + OVERTIME_GRACE_MS, lastSoundAtMs: end + OVERTIME_GRACE_MS }).stop, "overtime");
  // Không có giờ kết thúc thì chỉ dựa vào im lặng.
  assert.equal(autoStopState({ ...base, endsAtMs: null, nowMs: end + OVERTIME_GRACE_MS * 3, lastSoundAtMs: end + OVERTIME_GRACE_MS * 3 }).stop, null);
});

test("ten minutes of silence stop the recording, with a warning from minute seven", () => {
  const t = 5_000_000;
  const base = { endsAtMs: null, lastSoundAtMs: t, paused: false };
  assert.equal(autoStopState({ ...base, nowMs: t + 6 * 60_000 }).silenceLeftMs, null);
  assert.equal(autoStopState({ ...base, nowMs: t + SILENCE_WARN_MS }).silenceLeftMs, 3 * 60_000);
  assert.equal(autoStopState({ ...base, nowMs: t + SILENCE_STOP_MS }).stop, "silence");
  // Đang tạm dừng thì không tính im lặng.
  assert.deepEqual(autoStopState({ ...base, paused: true, nowMs: t + SILENCE_STOP_MS * 2 }), { stop: null, overtimeLeftMs: null, silenceLeftMs: null });
  assert.match(autoStopMessage("silence"), /Không nghe thấy tiếng nói trong 10 phút/);
  assert.match(autoStopMessage("overtime"), /quá giờ kết thúc cuộc họp 10 phút/);
  assert.equal(OVERTIME_EXTEND_MS, 30 * 60_000);
});

test("loudness separates speech from a quiet room", () => {
  assert.equal(rms([]), 0);
  const speech = Array.from({ length: 4096 }, (_, i) => 0.1 * Math.sin(i / 8));
  const room = Array.from({ length: 4096 }, (_, i) => 0.002 * Math.sin(i / 3));
  assert.ok(rms(speech) > SPEECH_RMS_THRESHOLD);
  assert.ok(rms(room) < SPEECH_RMS_THRESHOLD);
});

test("starting to record after the scheduled end gives 30 more minutes instead of stopping at once", () => {
  const end = 1_000_000;
  assert.equal(initialAutoStopEndsAt(null, end), null);
  assert.equal(initialAutoStopEndsAt(Number.NaN, end), null);
  assert.equal(initialAutoStopEndsAt(end, end - 60_000), end);
  const late = end + 25 * 60_000;
  const endsAt = initialAutoStopEndsAt(end, late)!;
  assert.equal(endsAt, late + OVERTIME_EXTEND_MS);
  assert.deepEqual(autoStopState({ nowMs: late + 500, endsAtMs: endsAt, lastSoundAtMs: late + 500, paused: false }), {
    stop: null,
    overtimeLeftMs: null,
    silenceLeftMs: null,
  });
});

test("auto-stop for silence keeps the recording only up to just after the last speech", () => {
  // 10 phút ghi = 120 đoạn 5 giây; lần cuối có tiếng ở phút thứ 2, giữ thêm 30 giây → 2:30 = 30 đoạn
  assert.equal(chunksToKeep(120, 150_000, 5_000), 30);
  // Mốc không chia hết thì làm tròn lên để không cắt mất lời nói
  assert.equal(chunksToKeep(120, 151_000, 5_000), 31);
  // Không bao giờ giữ nhiều hơn số đoạn đang có
  assert.equal(chunksToKeep(10, 600_000, 5_000), 10);
  // Luôn giữ đoạn đầu (chứa phần đầu file), kể cả khi chưa từng có tiếng nói
  assert.equal(chunksToKeep(120, 0, 5_000), 1);
  assert.equal(chunksToKeep(0, 30_000, 5_000), 0);
});
