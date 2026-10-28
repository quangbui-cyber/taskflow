import { uploadAndStartRecap } from "./api.js";

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

// Khởi tạo IndexedDB để lưu tạm các chunk âm thanh (phòng khi trình duyệt bị tắt đột ngột)
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("mycreative_recorder_db", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("chunks")) {
        db.createObjectStore("chunks", { autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveChunkToDb(blob) {
  try {
    const db = await openDatabase();
    const tx = db.transaction("chunks", "readwrite");
    tx.objectStore("chunks").add({ blob, timestamp: Date.now() });
  } catch (err) {
    console.warn("Lưu chunk vào IndexedDB lỗi:", err);
  }
}

async function clearDbChunks() {
  try {
    const db = await openDatabase();
    const tx = db.transaction("chunks", "readwrite");
    tx.objectStore("chunks").clear();
  } catch {
    // Bỏ qua lỗi dọn dẹp
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

  mediaRecorder.ondataavailable = async (event) => {
    if (event.data && event.data.size > 0) {
      currentChunks.push(event.data);
      await saveChunkToDb(event.data);
    }
  };

  recordingStartTime = Date.now();
  // Cắt chunk mỗi 5 giây
  mediaRecorder.start(5000);

  // Thông báo về service worker là đã bắt đầu thành công
  chrome.runtime.sendMessage({
    type: "RECORDING_STARTED",
    meetingId,
    startedAt: recordingStartTime,
    hasMic: Boolean(micAudioStream),
  });
}

async function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    return { ok: false, error: "Không có phiên ghi nào đang chạy." };
  }

  const durationSeconds = Math.round((Date.now() - recordingStartTime) / 1000);

  return new Promise((resolve, reject) => {
    mediaRecorder.onstop = async () => {
      try {
        const fullBlob = new Blob(currentChunks, { type: "audio/webm;codecs=opus" });

        // Dọn dẹp tài nguyên âm thanh
        if (tabAudioStream) {
          tabAudioStream.getTracks().forEach((t) => t.stop());
          tabAudioStream = null;
        }
        if (micAudioStream) {
          micAudioStream.getTracks().forEach((t) => t.stop());
          micAudioStream = null;
        }
        if (audioContext) {
          audioContext.close().catch(() => undefined);
          audioContext = null;
        }

        chrome.runtime.sendMessage({
          type: "RECORDING_STOPPED",
          durationSeconds,
          size: fullBlob.size,
        });

        // Tự động tải lên backend myCreative
        chrome.runtime.sendMessage({ type: "UPLOADING_START" });
        const recap = await uploadAndStartRecap({
          meetingId: currentMeetingId,
          fileBlob: fullBlob,
          fileName: currentFileName,
          durationSeconds,
          token: currentToken,
          baseUrl: currentBaseUrl,
        });

        await clearDbChunks();
        chrome.runtime.sendMessage({ type: "UPLOADING_SUCCESS", recap });
        resolve({ ok: true, recap });
      } catch (err) {
        console.error("Lỗi khi tải bản ghi âm lên myCreative:", err);
        chrome.runtime.sendMessage({
          type: "UPLOADING_ERROR",
          error: err.message || "Tải lên thất bại",
        });
        reject(err);
      } finally {
        mediaRecorder = null;
      }
    };

    mediaRecorder.stop();
  });
}

// Lắng nghe các lệnh từ background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return;

  if (message.type === "START") {
    startRecording(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "STOP") {
    stopRecording()
      .then((res) => sendResponse(res))
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
