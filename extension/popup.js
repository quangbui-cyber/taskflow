import {
  checkAuth,
  lookupMeeting,
  createQuickMeeting,
  getTodayMeetings,
  getConfig,
} from "./api.js";

const viewNotConnected = document.getElementById("viewNotConnected");
const viewReady = document.getElementById("viewReady");
const viewRecording = document.getElementById("viewRecording");
const viewUploading = document.getElementById("viewUploading");
const viewSuccess = document.getElementById("viewSuccess");
const viewFailed = document.getElementById("viewFailed");

const btnConnect = document.getElementById("btnConnect");
const btnOptions = document.getElementById("btnOptions");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnQuickMeeting = document.getElementById("btnQuickMeeting");
const btnOpenMeeting = document.getElementById("btnOpenMeeting");
const btnRetry = document.getElementById("btnRetry");
const btnDiscard = document.getElementById("btnDiscard");
const uploadingReason = document.getElementById("uploadingReason");
const failedMeetingName = document.getElementById("failedMeetingName");
const failedReason = document.getElementById("failedReason");

const SESSION_KEY = "current_recording_session";
const PENDING_KEY = "mycreative_pending_upload";
// Kết quả "đã gửi xong" chỉ đáng hiện nếu còn mới
const DONE_FRESH_MS = 30 * 60 * 1000;

const END_REASON_TEXT = {
  manual: "Bạn đã bấm dừng.",
  "tab-closed": "Tab cuộc họp đã đóng.",
  "tab-capture-ended": "Tab cuộc họp đã đóng hoặc chuyển trang.",
  navigated: "Tab đã rời khỏi cuộc họp.",
  "left-meeting": "Bạn đã rời cuộc họp.",
  "max-duration": "Đã đạt thời lượng ghi tối đa.",
};

const meetCodeBadge = document.getElementById("meetCodeBadge");
const userGreeting = document.getElementById("userGreeting");
const meetingTitle = document.getElementById("meetingTitle");
const meetingTime = document.getElementById("meetingTime");
const quickMeetingSection = document.getElementById("quickMeetingSection");
const timerDisplay = document.getElementById("timerDisplay");
const recMeetingName = document.getElementById("recMeetingName");

let currentTab = null;
let currentMeetCode = null;
let currentMeeting = null;
let timerInterval = null;
let currentUser = null;
// Giai đoạn của phiên đang hiển thị, để biết thay đổi trong storage nào cần vẽ lại
let shownPhase = null;

function showView(view) {
  [viewNotConnected, viewReady, viewRecording, viewUploading, viewSuccess, viewFailed].forEach((v) => {
    v.classList.add("hidden");
  });
  if (view !== viewRecording) stopTimer();
  view.classList.remove("hidden");
}

function formatTimer(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function startTimer(startedAt) {
  if (timerInterval) clearInterval(timerInterval);
  const update = () => {
    const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    timerDisplay.innerText = formatTimer(elapsed);
  };
  update();
  timerInterval = setInterval(update, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

/** Trích xuất mã cuộc họp Google Meet từ chuỗi bất kỳ (URL, Title, DOM text) */
function parseMeetCodeFromString(text) {
  if (!text) return null;
  // Dạng chuẩn: abc-defg-hij
  const match = text.match(/\b([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})\b/);
  if (match) return match[1].toLowerCase();

  // Dạng 10 ký tự liền nhau
  const cleanMatch = text.match(/meet\.google\.com\/(?:_meet\/|lookup\/)?([a-zA-Z]{10})\b/);
  if (cleanMatch) {
    const c = cleanMatch[1].toLowerCase();
    return `${c.slice(0, 3)}-${c.slice(3, 7)}-${c.slice(7)}`;
  }
  return null;
}

/** Quét sâu vào tab Meet để lấy mã phòng */
async function extractMeetCodeFromTab(tab) {
  if (!tab) return null;

  // 1. Thử từ URL của tab
  if (tab.url) {
    const codeFromUrl = parseMeetCodeFromString(tab.url);
    if (codeFromUrl) return codeFromUrl;
  }

  // 2. Thử từ tiêu đề của tab (Google Meet thường đặt title là "Meet - xxx-yyyy-zzz")
  if (tab.title) {
    const codeFromTitle = parseMeetCodeFromString(tab.title);
    if (codeFromTitle) return codeFromTitle;
  }

  // 3. Hỏi content script trong tab
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_MEET_CODE" });
    if (response?.meetCode) return response.meetCode;
  } catch {
    // Content script chưa nạp hoặc không phản hồi
  }

  // 4. Quét DOM trực tiếp bằng chrome.scripting
  try {
    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Quét tổng hợp các vị trí Meet lưu mã phòng
        const textToScan = [
          window.location.href,
          window.location.pathname,
          document.title,
          document.querySelector("[data-meeting-title]")?.textContent,
          document.querySelector("[data-unresolved-meeting-id]")?.textContent,
          document.querySelector("[data-call-id]")?.getAttribute("data-call-id"),
          document.querySelector('[jsname="r4nke"]')?.textContent,
          document.body ? document.body.innerText.slice(0, 4000) : "",
        ]
          .filter(Boolean)
          .join(" ");

        const m = textToScan.match(/\b([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})\b/);
        return m ? m[1].toLowerCase() : null;
      },
    });
    if (execResult?.result) {
      return execResult.result;
    }
  } catch (err) {
    console.warn("Scripting scan error:", err);
  }

  return null;
}

/**
 * Vẽ màn hình theo phiên ghi đang có (ghi / đang tải / xong / lỗi). Trả về true nếu đã vẽ.
 * Chỉ đọc storage nên vẫn đúng khi mất mạng.
 */
async function renderSessionState() {
  const [sessionData, pendingData] = await Promise.all([
    chrome.storage.session.get(SESSION_KEY),
    chrome.storage.local.get(PENDING_KEY),
  ]);
  const session = sessionData[SESSION_KEY];
  const pending = pendingData[PENDING_KEY];
  shownPhase = session?.phase ?? null;

  if (session?.phase === "recording" && session.startedAt) {
    showView(viewRecording);
    recMeetingName.innerText = session.meeting?.title || "Cuộc họp đang ghi";
    startTimer(session.startedAt);
    return true;
  }

  if (session?.phase === "uploading") {
    uploadingReason.innerText = END_REASON_TEXT[session.endReason] || "";
    showView(viewUploading);
    return true;
  }

  if (session?.phase === "done" && Date.now() - (session.finishedAt || 0) < DONE_FRESH_MS) {
    showView(viewSuccess);
    btnOpenMeeting.onclick = async () => {
      const { baseUrl } = await getConfig();
      chrome.tabs.create({ url: `${baseUrl}/meetings/${session.meeting.id}/recap` });
    };
    // Đã xem rồi thì lần mở sau về màn hình ban đầu
    await chrome.storage.session.remove(SESSION_KEY);
    return true;
  }

  if (session?.phase === "failed" || (!session && pending)) {
    failedMeetingName.innerText = session?.meeting?.title || pending?.title || "";
    failedReason.innerText = session?.error || pending?.error || "Bản ghi trước đó chưa được tải lên (trình duyệt đã tắt giữa chừng).";
    showView(viewFailed);
    return true;
  }

  return false;
}

async function init() {
  btnOptions.onclick = () => chrome.runtime.openOptionsPage();
  btnConnect.onclick = async () => {
    const { baseUrl } = await getConfig();
    chrome.tabs.create({ url: `${baseUrl}/profile/extension` });
  };

  // 1. Phiên ghi đang diễn ra / vừa kết thúc
  if (await renderSessionState()) return;

  // 2. Kiểm tra xác thực tài khoản
  try {
    currentUser = await checkAuth();
  } catch {
    currentUser = null;
  }

  if (!currentUser) {
    showView(viewNotConnected);
    return;
  }

  userGreeting.innerText = currentUser.name || currentUser.email;

  // 3. Quét tab hiện tại
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) {
    const fallbackTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = fallbackTabs[0];
  }

  // Nếu tab hiện tại không phải Meet, tìm xem có tab Meet nào đang mở ở cửa sổ khác không
  const isCurrentTabMeet = tab?.url && (tab.url.includes("meet.google.com") || tab.url.includes("g.co/meet"));
  if (!isCurrentTabMeet) {
    const meetTabs = await chrome.tabs.query({ url: "*://meet.google.com/*" });
    if (meetTabs.length > 0) {
      tab = meetTabs[0];
    }
  }

  currentTab = tab;

  if (!tab) {
    meetingTitle.innerText = "Không tìm thấy tab cuộc họp";
    showView(viewReady);
    return;
  }

  // Quét mã phòng
  currentMeetCode = await extractMeetCodeFromTab(tab);

  if (!currentMeetCode) {
    // Không tìm thấy mã Meet
    meetCodeBadge.innerText = "Chưa vào phòng Meet";
    meetCodeBadge.style.background = "#f4f4f5";
    meetCodeBadge.style.color = "#71717a";
    meetingTitle.innerText = "Hãy mở tab Google Meet để ghi biên bản 1 click.";
    meetingTime.innerText = "Hoặc lên lịch cuộc họp trong myCreative.";
    btnStart.disabled = true;
    btnStart.style.opacity = "0.5";
    btnStart.innerHTML = `<span>●</span> Bắt đầu ghi biên bản`;
    quickMeetingSection.classList.add("hidden");
    showView(viewReady);
    return;
  }

  // ĐÃ PHÁT HIỆN MÃ PHÒNG MEET
  meetCodeBadge.innerText = `Meet: ${currentMeetCode}`;
  meetCodeBadge.style.background = "#dcfce7";
  meetCodeBadge.style.color = "#15803d";

  try {
    const meeting = await lookupMeeting(currentMeetCode);
    if (meeting) {
      // Khớp cuộc họp đã lên lịch
      currentMeeting = meeting;
      meetingTitle.innerText = meeting.title;
      const start = new Date(meeting.startAt);
      const end = new Date(meeting.endAt);
      const timeStr = `${start.getHours().toString().padStart(2, "0")}:${start.getMinutes().toString().padStart(2, "0")} – ${end.getHours().toString().padStart(2, "0")}:${end.getMinutes().toString().padStart(2, "0")}`;
      meetingTime.innerText = `${timeStr} (Khớp lịch myCreative)`;
      btnStart.disabled = false;
      btnStart.style.opacity = "1";
      btnStart.innerHTML = `<span>●</span> Bắt đầu ghi biên bản`;
      quickMeetingSection.classList.add("hidden");
    } else {
      // Cuộc họp tức thì (Instant Meeting) - Cho phép ghi ngay mà không chặn người dùng!
      currentMeeting = null;
      meetingTitle.innerText = `Họp Google Meet (${currentMeetCode})`;
      meetingTime.innerText = "Cuộc họp tức thì · Tự động tạo và lưu biên bản vào myCreative khi bấm ghi";
      btnStart.disabled = false;
      btnStart.style.opacity = "1";
      btnStart.innerHTML = `<span>●</span> Bắt đầu ghi biên bản tức thì`;
      quickMeetingSection.classList.add("hidden");
    }
  } catch (err) {
    // Ngay cả khi lookup có lỗi mạng, vẫn cho phép ghi tức thì
    currentMeeting = null;
    meetingTitle.innerText = `Họp Google Meet (${currentMeetCode})`;
    meetingTime.innerText = "Tự động tạo cuộc họp nhanh trên myCreative khi bắt đầu";
    btnStart.disabled = false;
    btnStart.style.opacity = "1";
    btnStart.innerHTML = `<span>●</span> Bắt đầu ghi biên bản tức thì`;
    quickMeetingSection.classList.add("hidden");
  }

  showView(viewReady);
}

// Bắt đầu ghi âm (hỗ trợ cả cuộc họp có lịch và cuộc họp tức thì)
btnStart.onclick = async () => {
  if (!currentTab?.id) return;
  btnStart.disabled = true;
  btnStart.innerHTML = `<span class="spinner"></span> Đang khởi động...`;

  try {
    // Nếu là cuộc họp tức thì (chưa có trong database), tự động tạo nhanh cuộc họp trước
    if (!currentMeeting) {
      btnStart.innerHTML = `<span class="spinner"></span> Đang tạo cuộc họp trên myCreative...`;
      const created = await createQuickMeeting({
        title: `Họp Google Meet (${currentMeetCode || "tức thì"})`,
        meetingUrl: currentTab.url || (currentMeetCode ? `https://meet.google.com/${currentMeetCode}` : undefined),
      });
      currentMeeting = created;
    }

    btnStart.innerHTML = `<span class="spinner"></span> Đang kết nối âm thanh...`;

    // Stream ID chỉ có hiệu lực ngắn sau thao tác của người dùng nên lấy ở đây, phần còn lại do service worker lo
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: currentTab.id });

    const res = await chrome.runtime.sendMessage({
      type: "START_SESSION",
      payload: {
        tabId: currentTab.id,
        streamId,
        meeting: currentMeeting,
        meetCode: currentMeetCode,
      },
    });
    if (!res?.ok) throw new Error(res?.error || "Không thể khởi động ghi âm");

    showView(viewRecording);
    recMeetingName.innerText = currentMeeting.title;
    startTimer(res.session.startedAt);
    shownPhase = "recording";
  } catch (err) {
    alert(`Lỗi: ${err.message}`);
    btnStart.disabled = false;
    btnStart.innerHTML = `<span>●</span> Bắt đầu ghi biên bản`;
  }
};

// Tạo cuộc họp nhanh thủ công nếu muốn
if (btnQuickMeeting) {
  btnQuickMeeting.onclick = async () => {
    btnStart.click();
  };
}

// Dừng ghi âm: service worker chốt file rồi tải lên ở nền, popup chỉ theo dõi trạng thái trong storage
btnStop.onclick = async () => {
  if (!confirm("Bạn có chắc chắn muốn kết thúc và lưu biên bản cuộc họp này?")) return;
  showView(viewUploading);
  shownPhase = "uploading";

  const res = await chrome.runtime.sendMessage({ type: "STOP_SESSION" });
  if (!res?.ok) {
    alert(`Lỗi khi dừng: ${res?.error || "Không rõ lỗi"}`);
    init();
  }
};

btnRetry.onclick = async () => {
  btnRetry.disabled = true;
  const res = await chrome.runtime.sendMessage({ type: "RETRY_UPLOAD" });
  btnRetry.disabled = false;
  if (!res?.ok) alert(`Không tải lại được: ${res?.error || "Không rõ lỗi"}`);
};

btnDiscard.onclick = async () => {
  if (!confirm("Bỏ bản ghi này? Bạn sẽ không lấy lại được nội dung cuộc họp đã ghi.")) return;
  await chrome.runtime.sendMessage({ type: "DISCARD_PENDING" });
  init();
};

// Phiên đổi giai đoạn (dừng tự động, tải xong, lỗi...) khi popup đang mở thì vẽ lại
chrome.storage.onChanged.addListener((changes, area) => {
  const change = area === "session" ? changes[SESSION_KEY] : area === "local" ? changes[PENDING_KEY] : null;
  if (!change) return;
  const nextPhase = change.newValue?.phase ?? null;
  if (area === "session") {
    if (nextPhase === shownPhase) return;
    // Màn hình "đã gửi xong" tự xoá phiên sau khi hiện, không vẽ lại
    if (nextPhase === null && shownPhase === "done") return;
  }
  init();
});

init();
