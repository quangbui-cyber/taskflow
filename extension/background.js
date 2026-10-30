/**
 * myCreative Recorder - Service Worker (Background Script)
 *
 * Service worker là nơi duy nhất quyết định vòng đời một phiên ghi:
 *   recording -> uploading -> done | failed
 * Popup, phím tắt, đóng tab, rời họp... đều đi qua cùng một hàm endSession() nên không bao giờ dừng hai lần.
 */

import { lookupMeeting, connectWithToken, getConfig, CONNECT_ORIGINS } from "./api.js";

const OFFSCREEN_PATH = "offscreen.html";
const SESSION_KEY = "current_recording_session"; // chrome.storage.session
const PENDING_KEY = "mycreative_pending_upload"; // chrome.storage.local: bản ghi chưa tải lên xong
const TIMER_ALARM = "recording_timer";
const MAX_RECORDING_MINUTES = 225; // Tối đa của app
// Chờ một chút sau khi phát hiện rời họp, phòng bấm nhầm "Rời" rồi "Tham gia lại" ngay
const LEAVE_GRACE_MS = 5000;

const END_REASON_LABEL = {
  manual: "Bạn đã bấm dừng",
  "tab-closed": "Tab cuộc họp đã đóng",
  "tab-capture-ended": "Tab cuộc họp đã đóng hoặc chuyển trang",
  navigated: "Tab đã rời khỏi cuộc họp",
  "left-meeting": "Bạn đã rời cuộc họp",
  "max-duration": "Đã đạt thời lượng tối đa",
  retry: "Tải lại bản ghi cũ",
};

let leaveTimer = null;
let endInFlight = null;

// ---------- Trạng thái phiên ----------

async function getSession() {
  const data = await chrome.storage.session.get(SESSION_KEY);
  return data[SESSION_KEY] || null;
}

async function setSession(session) {
  if (session) {
    await chrome.storage.session.set({ [SESSION_KEY]: session });
  } else {
    await chrome.storage.session.remove(SESSION_KEY);
  }
}

async function patchSession(patch) {
  const session = await getSession();
  if (!session) return null;
  const next = { ...session, ...patch };
  await setSession(next);
  return next;
}

async function getPending() {
  const data = await chrome.storage.local.get(PENDING_KEY);
  return data[PENDING_KEY] || null;
}

// ---------- Offscreen document ----------

async function hasOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return existing.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Ghi âm tab cuộc họp và micro để lập biên bản",
  });
}

async function closeOffscreenDocument() {
  // Đang ghi hoặc đang tải thì không đóng, kẻo mất bản ghi
  const session = await getSession();
  if (session && (session.phase === "recording" || session.phase === "uploading")) return;
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

function sendToOffscreen(type, payload) {
  return chrome.runtime.sendMessage({ target: "offscreen", type, payload });
}

// ---------- Badge & thông báo ----------

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

const BADGE_RED = "#dc2626";
const BADGE_AMBER = "#d97706";

function showNotification(id, title, message) {
  try {
    chrome.notifications.create(id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message,
      priority: 1,
    });
  } catch (err) {
    console.warn("Không hiện được thông báo:", err);
  }
}

// ---------- Bắt đầu ----------

/**
 * Bắt đầu ghi một tab. `streamId` do nơi gọi lấy (popup hoặc phím tắt) vì chỉ có hiệu lực ngắn
 * sau thao tác của người dùng.
 */
export async function startRecordingSession({ tabId, streamId, meeting, meetCode }) {
  const current = await getSession();
  if (current?.phase === "recording") throw new Error("Đang có một phiên ghi âm khác đang chạy.");
  if (current?.phase === "uploading") {
    throw new Error("Bản ghi trước vẫn đang được tải lên, vui lòng đợi trong giây lát.");
  }

  const finalStreamId = streamId || (await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }));
  await ensureOffscreenDocument();
  const { token, baseUrl } = await getConfig();
  const startedAt = Date.now();
  const fileName = `meet_${meeting.meetCode || meeting.id}_${startedAt}.webm`;

  const response = await sendToOffscreen("START", {
    streamId: finalStreamId,
    meetingId: meeting.id,
    fileName,
    token,
    baseUrl,
  });
  if (!response || !response.ok) {
    throw new Error(response?.error || "Không thể khởi động ghi âm.");
  }

  const session = {
    phase: "recording",
    tabId,
    meeting,
    meetCode: meetCode || meeting.meetCode || null,
    startedAt,
  };
  await setSession(session);
  // Ghi lại ngay từ lúc bắt đầu: nếu trình duyệt tắt đột ngột, lần sau vẫn tải lại được từ IndexedDB
  await chrome.storage.local.set({
    [PENDING_KEY]: { meetingId: meeting.id, title: meeting.title || "", fileName, startedAt },
  });
  setBadge("REC", BADGE_RED);
  chrome.alarms.create(TIMER_ALARM, { periodInMinutes: 0.5 });

  // Gửi thông báo minh bạch vào chat Google Meet
  chrome.storage.local.get("mycreative_user", (data) => {
    const userName = data.mycreative_user?.name || "";
    chrome.tabs.sendMessage(tabId, { type: "SEND_CHAT_NOTICE", userName }).catch(() => undefined);
  });

  return session;
}

// ---------- Kết thúc ----------

/**
 * Kết thúc phiên đang ghi vì bất kỳ lý do nào. An toàn khi gọi nhiều lần / từ nhiều nguồn cùng lúc:
 * chỉ lần đầu thật sự dừng, các lần sau thấy phiên đã sang "uploading" và bỏ qua.
 */
export function endSession(reason) {
  if (endInFlight) return endInFlight;

  endInFlight = (async () => {
    clearTimeout(leaveTimer);
    leaveTimer = null;

    const session = await getSession();
    if (!session || session.phase !== "recording") {
      return { ok: false, error: "Không có phiên ghi nào đang chạy." };
    }

    await patchSession({ phase: "uploading", endReason: reason, endedAt: Date.now() });
    chrome.alarms.clear(TIMER_ALARM);
    setBadge("↑", BADGE_AMBER);

    let response;
    try {
      response = await sendToOffscreen("STOP", { reason });
    } catch (err) {
      response = { ok: false, error: err.message };
    }

    // Offscreen đã tự dừng trước đó (tab capture kết thúc) vẫn trả ok:true cho cùng một lần dừng.
    // Trả ok:false nghĩa là không còn trình ghi nào chạy, bản ghi chỉ còn trong IndexedDB.
    if (!response?.ok && (await getSession())?.phase === "uploading") {
      await failSession(response?.error || "Dừng ghi âm thất bại.");
    }
    return response || { ok: false };
  })().finally(() => {
    endInFlight = null;
  });

  return endInFlight;
}

async function completeSession() {
  const session = await getSession();
  await chrome.storage.local.remove(PENDING_KEY);
  await patchSession({ phase: "done", finishedAt: Date.now() });
  setBadge("");

  const meetingId = session?.meeting?.id;
  showNotification(
    `recap-ok:${meetingId || ""}`,
    "Đã gửi bản ghi cuộc họp",
    `${session?.meeting?.title || "Cuộc họp"} (${END_REASON_LABEL[session?.endReason] || "đã kết thúc"}). AI đang chép lời và viết biên bản, bấm để mở.`
  );
  setTimeout(() => closeOffscreenDocument().catch(() => undefined), 1500);
}

async function failSession(error) {
  const pending = await getPending();
  if (pending) {
    await chrome.storage.local.set({ [PENDING_KEY]: { ...pending, error } });
  }
  await patchSession({ phase: "failed", error, finishedAt: Date.now() });
  chrome.alarms.clear(TIMER_ALARM);
  setBadge("!", BADGE_RED);

  const session = await getSession();
  showNotification(
    "recap-failed",
    "Chưa tải được bản ghi cuộc họp",
    `${session?.meeting?.title || pending?.title || "Cuộc họp"}: ${error}. Mở extension và bấm "Thử tải lại" (bản ghi vẫn được giữ trên máy).`
  );
  setTimeout(() => closeOffscreenDocument().catch(() => undefined), 1500);
}

/** Tải lại bản ghi còn lưu trong IndexedDB (sau lỗi mạng hoặc khi trình duyệt bị tắt giữa chừng) */
export async function retryPendingUpload() {
  const pending = await getPending();
  if (!pending) throw new Error("Không có bản ghi nào đang chờ tải lên.");

  const current = await getSession();
  if (current?.phase === "recording" || current?.phase === "uploading") {
    throw new Error("Đang có phiên ghi hoặc đang tải lên.");
  }

  await ensureOffscreenDocument();
  const { token, baseUrl } = await getConfig();
  await setSession({
    phase: "uploading",
    tabId: null,
    meeting: { id: pending.meetingId, title: pending.title },
    startedAt: pending.startedAt,
    endReason: "retry",
  });
  setBadge("↑", BADGE_AMBER);

  const response = await sendToOffscreen("RETRY_UPLOAD", {
    meetingId: pending.meetingId,
    fileName: pending.fileName,
    startedAt: pending.startedAt,
    token,
    baseUrl,
  });
  if (!response?.ok) {
    await failSession(response?.error || "Không tải lại được bản ghi.");
    throw new Error(response?.error || "Không tải lại được bản ghi.");
  }
}

async function discardPending() {
  await chrome.storage.local.remove(PENDING_KEY);
  await setSession(null);
  setBadge("");
}

// ---------- Tín hiệu kết thúc cuộc họp ----------

// 1. Đóng tab cuộc họp
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSession();
  if (session?.phase === "recording" && session.tabId === tabId) {
    console.log("Tab cuộc họp đã bị đóng, tự động lưu bản ghi...");
    await endSession("tab-closed").catch(console.error);
  }
});

// 2. Tab chuyển sang trang khác (không còn ở phòng họp này)
function isSameMeeting(url, meetCode) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (parsed.hostname !== "meet.google.com") return false;
  if (!meetCode) return true;
  const letters = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
  return letters(parsed.pathname).includes(letters(meetCode));
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const session = await getSession();
  if (session?.phase !== "recording" || session.tabId !== tabId) return;
  if (!isSameMeeting(changeInfo.url, session.meetCode)) {
    await endSession("navigated").catch(console.error);
  }
});

// 3. Rời cuộc họp / host kết thúc cuộc họp (content-meet.js phát hiện), có thời gian chờ ngắn
async function handleMeetLeft(sender) {
  const session = await getSession();
  if (session?.phase !== "recording" || !sender.tab || session.tabId !== sender.tab.id) return;
  if (leaveTimer) return; // Đã hẹn rồi, không dời hẹn mỗi lần nhận thêm tin
  console.log(`Phát hiện rời phòng họp, tự động kết thúc sau ${LEAVE_GRACE_MS / 1000}s...`);
  leaveTimer = setTimeout(() => {
    leaveTimer = null;
    endSession("left-meeting").catch(console.error);
  }, LEAVE_GRACE_MS);
}

function handleMeetJoined(sender) {
  if (!leaveTimer) return;
  getSession().then((session) => {
    if (session && sender.tab && session.tabId === sender.tab.id) {
      console.log("Người dùng vào lại phòng họp, huỷ lệnh tự kết thúc.");
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  });
}

// 4. Đồng hồ: cập nhật badge, giới hạn thời lượng, và "lưới an toàn" nếu lỡ mất sự kiện đóng tab
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TIMER_ALARM) return;
  const session = await getSession();
  if (session?.phase !== "recording") {
    chrome.alarms.clear(TIMER_ALARM);
    return;
  }

  const elapsedMins = Math.floor((Date.now() - session.startedAt) / 60000);
  setBadge(elapsedMins > 0 ? `${elapsedMins}m` : "REC", BADGE_RED);

  if (elapsedMins >= MAX_RECORDING_MINUTES) {
    await endSession("max-duration").catch(console.error);
    return;
  }

  try {
    await chrome.tabs.get(session.tabId);
  } catch {
    await endSession("tab-closed").catch(console.error);
    return;
  }

  if (!(await hasOffscreenDocument())) {
    await failSession("Trình ghi âm đã bị trình duyệt đóng bất ngờ.");
  }
});

// ---------- Phím tắt Alt+Shift+R ----------

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-recording") return;

  const session = await getSession();
  if (session?.phase === "recording") {
    await endSession("manual").catch(console.error);
    return;
  }
  if (session?.phase === "uploading") return;

  // Nếu chưa ghi, tìm tab đang xem
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
  }
  if (!tab || !tab.id) return;

  const textToScan = (tab.url || "") + " " + (tab.title || "");
  const match = textToScan.match(/\b([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})\b/);
  if (!match) {
    return;
  }

  const meetCode = match[1].toLowerCase();
  try {
    let meeting = await lookupMeeting(meetCode);
    if (!meeting) {
      // Tự động tạo cuộc họp nhanh nếu chưa có trên lịch
      const { createQuickMeeting } = await import("./api.js");
      meeting = await createQuickMeeting({
        title: `Họp Google Meet (${meetCode})`,
        meetingUrl: tab.url || `https://meet.google.com/${meetCode}`,
      });
    }
    if (meeting) {
      await startRecordingSession({ tabId: tab.id, meeting, meetCode });
    }
  } catch (err) {
    console.error("Lỗi khi tự động kích hoạt ghi âm qua phím tắt:", err);
  }
});

// ---------- Kết nối tài khoản ----------

// Nhận token từ trang kết nối (content-connect.js), kiểm tra rồi lưu
async function handleConnectToken(message, sender) {
  let origin = "";
  try {
    origin = sender.origin || new URL(sender.url).origin;
  } catch {
    origin = "";
  }
  // Chỉ tin trang myCreative thật, không tin trang bất kỳ khác (vd. *.vercel.app)
  if (!sender.tab || !CONNECT_ORIGINS.includes(origin)) {
    return { ok: false, error: "Trang này không được phép kết nối Extension." };
  }

  try {
    const { mycreative_token: previousToken } = await chrome.storage.local.get("mycreative_token");
    const user = await connectWithToken({ token: message.token, baseUrl: origin });

    // Lần kết nối đầu tiên: mở trang cài đặt để xin quyền micro luôn
    if (!previousToken) {
      chrome.tabs.create({ url: chrome.runtime.getURL("options.html?setup=mic") });
    }
    return { ok: true, user };
  } catch (err) {
    return { ok: false, error: err.message || "Kết nối thất bại." };
  }
}

// ---------- Tin nhắn ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Offscreen document không có chrome.storage nên hỏi cấu hình qua đây
  if (message.type === "GET_CONFIG") {
    getConfig().then(sendResponse);
    return true;
  }

  if (message.type === "CONNECT_TOKEN") {
    handleConnectToken(message, sender).then(sendResponse);
    return true;
  }

  // Từ popup
  if (message.type === "START_SESSION") {
    startRecordingSession(message.payload)
      .then((session) => sendResponse({ ok: true, session }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "STOP_SESSION") {
    endSession("manual").then(sendResponse);
    return true;
  }

  if (message.type === "RETRY_UPLOAD") {
    retryPendingUpload()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "DISCARD_PENDING") {
    discardPending().then(() => sendResponse({ ok: true }));
    return true;
  }

  // Từ content-meet.js
  if (message.type === "MEET_LEFT") {
    handleMeetLeft(sender);
    return false;
  }

  if (message.type === "MEET_JOINED") {
    handleMeetJoined(sender);
    return false;
  }

  // Từ offscreen document
  if (message.type === "RECORDING_STOPPED") {
    // Offscreen tự dừng (tab capture kết thúc) trước cả khi service worker kịp biết
    getSession().then(async (session) => {
      if (session?.phase !== "recording") return;
      clearTimeout(leaveTimer);
      leaveTimer = null;
      await patchSession({ phase: "uploading", endReason: message.reason, endedAt: Date.now() });
      chrome.alarms.clear(TIMER_ALARM);
      setBadge("↑", BADGE_AMBER);
    });
    return false;
  }

  if (message.type === "UPLOADING_SUCCESS") {
    completeSession().catch(console.error);
    return false;
  }

  if (message.type === "UPLOADING_ERROR") {
    failSession(message.error || "Tải lên thất bại").catch(console.error);
    return false;
  }

  return false;
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);
  if (!notificationId.startsWith("recap-ok:")) return;
  const meetingId = notificationId.slice("recap-ok:".length);
  if (!meetingId) return;
  const { baseUrl } = await getConfig();
  chrome.tabs.create({ url: `${baseUrl}/meetings/${meetingId}/recap` });
});

// ---------- Khởi động / cài đặt ----------

// Còn bản ghi chưa tải lên từ lần trước (trình duyệt tắt giữa chừng, hoặc upload lỗi): nhắc bằng badge
chrome.runtime.onStartup.addListener(async () => {
  if (await getPending()) setBadge("!", BADGE_RED);
});

// Tab Meet đã mở trước khi cài / cập nhật extension chưa có content script: nạp bổ sung
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
    for (const tab of tabs) {
      chrome.scripting
        .executeScript({ target: { tabId: tab.id }, files: ["content-meet.js"] })
        .catch(() => undefined);
    }
  } catch {
    // Không có quyền hoặc không có tab nào
  }
});
