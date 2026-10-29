import { uploadAndStartRecap } from "./api.js";

const CHUNK_MS = 5000;
const UPLOAD_RETRY_DELAYS_MS = [0, 5000, 15000];

let mediaRecorder = null;
let audioContext = null;
let tabAudioStream = null;
let micAudioStream = null;
let recordingStartTime = 0;
let currentMeetingId = null;
let currentFileName = null;
let currentToken = null;
let currentBaseUrl = null;
let currentChunks = [];
// Chỉ có một lần dừng cho mỗi phiên: tab đóng, rời họp, bấm dừng... có thể đến cùng lúc
let stopPromise = null;

// IndexedDB giữ các chunk để còn tải lại được nếu upload lỗi hoặc trình duyệt tắt đột ngột
let dbPromise = null;
function openDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("mycreative_recorder_db", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("chunks")) {
          db.createObjectStore("chunks", { autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function saveChunkToDb(blob) {
  try {
    const db = await openDatabase();
    const tx = db.transaction("chunks", "readwrite");
    tx.objectStore("chunks").add({ blob, timestamp: Date.now() });
    await txDone(tx);
  } catch (err) {
    console.warn("Lưu chunk vào IndexedDB lỗi:", err);
  }
}

async function clearDbChunks() {
  try {
    const db = await openDatabase();
    const tx = db.transaction("chunks", "readwrite");
    tx.objectStore("chunks").clear();
    await txDone(tx);
  } catch {
    // Bỏ qua lỗi dọn dẹp
  }
}

async function readDbChunks() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("chunks", "readonly").objectStore("chunks").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function notify(message) {
  try {
    chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // Service worker không nhận được thì thôi, trạng thái đã nằm trong storage
  }
}

function releaseAudio() {
  for (const stream of [tabAudioStream, micAudioStream]) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }
  tabAudioStream = null;
  micAudioStream = null;
  if (audioContext) {
    audioContext.close().catch(() => undefined);
    audioContext = null;
  }
}

async function startRecording({ streamId, meetingId, fileName, token, baseUrl }) {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    throw new Error("Đang có phiên ghi âm khác đang chạy.");
  }

  currentMeetingId = meetingId;
  currentFileName = fileName || `meet_${meetingId}_${Date.now()}.webm`;
  currentToken = token || null;
  currentBaseUrl = baseUrl || null;
  currentChunks = [];
  stopPromise = null;
  await clearDbChunks();

  // 1. Thu âm thanh tab từ streamId
  tabAudioStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  // 2. Thu âm thanh micro của người dùng (có chống vọng âm / lọc ồn)
  try {
    micAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (micErr) {
    console.warn("Không mở được micro, tiếp tục chỉ với âm thanh tab:", micErr);
    micAudioStream = null;
  }

  // 3. Trộn âm thanh tab + mic bằng Web Audio API
  audioContext = new AudioContext();

  const tabSource = audioContext.createMediaStreamSource(tabAudioStream);

  // QUAN TRỌNG: Loopback âm thanh tab ra loa máy tính để người dùng vẫn nghe được đối phương nói!
  tabSource.connect(audioContext.destination);

  // Mixer đích để ghi âm
  const mixerDestination = audioContext.createMediaStreamDestination();
  tabSource.connect(mixerDestination);

  if (micAudioStream) {
    const micSource = audioContext.createMediaStreamSource(micAudioStream);
    micSource.connect(mixerDestination);
  }

  // 4. Khởi chạy MediaRecorder định dạng Opus 48 kbps
  mediaRecorder = new MediaRecorder(mixerDestination.stream, {
    mimeType: "audio/webm;codecs=opus",
    audioBitsPerSecond: 48000,
  });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      currentChunks.push(event.data);
      void saveChunkToDb(event.data);
    }
  };

  // Tab họp bị đóng / chuyển trang thì track âm thanh tab tự kết thúc. Đây là tín hiệu đáng tin nhất
  // vì chạy ngay trong trang này, không phụ thuộc service worker còn sống hay không.
  tabAudioStream.getAudioTracks().forEach((track) => {
    track.addEventListener("ended", () => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        void stopRecording("tab-capture-ended");
      }
    });
  });

  recordingStartTime = Date.now();
  mediaRecorder.start(CHUNK_MS);

  notify({
    type: "RECORDING_STARTED",
    meetingId,
    startedAt: recordingStartTime,
    hasMic: Boolean(micAudioStream),
  });
}

/**
 * Dừng ghi và trả lời ngay khi file đã chốt xong. Việc tải lên chạy tiếp ở nền và báo kết quả
 * qua UPLOADING_SUCCESS / UPLOADING_ERROR, để người gọi (popup, service worker) không phải đứng chờ.
 */
function stopRecording(reason = "manual") {
  if (stopPromise) return stopPromise;
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    return Promise.resolve({ ok: false, error: "Không có phiên ghi nào đang chạy." });
  }

  const recorder = mediaRecorder;
  const durationSeconds = Math.round((Date.now() - recordingStartTime) / 1000);
  const meetingId = currentMeetingId;

  stopPromise = new Promise((resolve) => {
    recorder.onstop = () => {
      releaseAudio();
      mediaRecorder = null;

      const fullBlob = new Blob(currentChunks, { type: "audio/webm;codecs=opus" });
      currentChunks = [];

      resolve({ ok: true, durationSeconds, size: fullBlob.size });
      notify({ type: "RECORDING_STOPPED", reason, meetingId, durationSeconds, size: fullBlob.size });

      void uploadWithRetry({
        meetingId,
        fileBlob: fullBlob,
        fileName: currentFileName,
        durationSeconds,
        token: currentToken,
        baseUrl: currentBaseUrl,
      });
    };
    recorder.stop();
  });

  return stopPromise;
}

function shouldRetry(err) {
  // Lỗi mạng (không có status) hoặc server 5xx thì thử lại; 4xx (hết hạn mức, token sai...) thì không
  return !err?.status || err.status >= 500;
}

async function uploadWithRetry(params) {
  notify({ type: "UPLOADING_START", meetingId: params.meetingId });
  let lastError = null;

  for (const delay of UPLOAD_RETRY_DELAYS_MS) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      const recap = await uploadAndStartRecap(params);
      await clearDbChunks();
      notify({ type: "UPLOADING_SUCCESS", meetingId: params.meetingId, recap });
      stopPromise = null;
      return;
    } catch (err) {
      lastError = err;
      console.error("Lỗi khi tải bản ghi âm lên myCreative:", err);
      if (!shouldRetry(err)) break;
    }
  }

  // Giữ nguyên chunk trong IndexedDB để người dùng bấm "Thử tải lại" sau
  notify({
    type: "UPLOADING_ERROR",
    meetingId: params.meetingId,
    error: lastError?.message || "Tải lên thất bại",
  });
  stopPromise = null;
}

/** Dựng lại file từ IndexedDB rồi tải lên (sau lỗi mạng, hoặc trình duyệt bị tắt giữa chừng) */
async function retryUpload({ meetingId, fileName, startedAt, token, baseUrl }) {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    throw new Error("Đang có phiên ghi âm khác đang chạy.");
  }

  const rows = await readDbChunks();
  if (rows.length === 0) throw new Error("Không còn dữ liệu ghi âm để tải lại.");

  const fileBlob = new Blob(
    rows.map((r) => r.blob),
    { type: "audio/webm;codecs=opus" }
  );
  const lastTimestamp = rows[rows.length - 1].timestamp || Date.now();
  const durationSeconds = Math.max(1, Math.round((lastTimestamp - (startedAt || lastTimestamp)) / 1000));

  void uploadWithRetry({
    meetingId,
    fileBlob,
    fileName: fileName || `meet_${meetingId}_${Date.now()}.webm`,
    durationSeconds,
    token: token || null,
    baseUrl: baseUrl || null,
  });
}

// Lắng nghe các lệnh từ background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return;

  if (message.type === "START") {
    startRecording(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        releaseAudio();
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (message.type === "STOP") {
    stopRecording(message.payload?.reason || "manual")
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "RETRY_UPLOAD") {
    retryUpload(message.payload || {})
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "STATUS") {
    sendResponse({
      recording: mediaRecorder ? mediaRecorder.state === "recording" : false,
      startedAt: recordingStartTime,
      meetingId: currentMeetingId,
    });
    return false;
  }
});
