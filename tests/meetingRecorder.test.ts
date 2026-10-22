import assert from "node:assert/strict";
import { test } from "node:test";
import { recapAudioContentType, recapAudioPathname } from "../lib/meetingRecap";
import {
  RECORDING_BITS_PER_SECOND,
  microphoneErrorMessage,
  pickRecordingMimeType,
  recordingFileName,
  recordingFileType,
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
