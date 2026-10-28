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

const btnConnect = document.getElementById("btnConnect");
const btnOptions = document.getElementById("btnOptions");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnQuickMeeting = document.getElementById("btnQuickMeeting");
const btnOpenMeeting = document.getElementById("btnOpenMeeting");

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

function showView(view) {
  [viewNotConnected, viewReady, viewRecording, viewUploading, viewSuccess].forEach((v) => {
    v.classList.add("hidden");
  });
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

async function init() {
  btnOptions.onclick = () => chrome.runtime.openOptionsPage();
  btnConnect.onclick = async () => {
    const { baseUrl } = await getConfig();
    chrome.tabs.create({ url: `${baseUrl}/profile/extension` });
  };

  // 1. Kiểm tra xác thực tài khoản
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

  // 2. Kiểm tra xem có phiên ghi âm nào đang diễn ra không
  const sessionData = await chrome.storage.session.get("current_recording_session");
  const session = sessionData.current_recording_session;

  if (session && session.startedAt) {
    showView(viewRecording);
    recMeetingName.innerText = session.meeting?.title || "Cuộc họp đang ghi";
    startTimer(session.startedAt);
    return;
  }

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

    // 1. Lấy Stream ID cho tab Google Meet
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: currentTab.id });

    // 2. Tạo offscreen document nếu chưa có
    const existing = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (existing.length === 0) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: "Ghi âm cuộc họp và micro",
      });
    }

    // 3. Gửi lệnh bắt đầu ghi âm sang offscreen
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          target: "offscreen",
          type: "START",
          payload: {
            streamId,
            meetingId: currentMeeting.id,
            fileName: `meet_${currentMeeting.meetCode || currentMeeting.id}_${Date.now()}.webm`,
          },
        },
        async (res) => {
          if (!res || !res.ok) {
            reject(new Error(res?.error || "Không thể khởi động ghi âm"));
            return;
          }
          const session = {
            tabId: currentTab.id,
            meeting: currentMeeting,
            startedAt: Date.now(),
          };
          await chrome.storage.session.set({ current_recording_session: session });
          chrome.action.setBadgeText({ text: "REC" });
          chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });

          // Gửi thông báo minh bạch vào chat Google Meet
          chrome.tabs
            .sendMessage(currentTab.id, {
              type: "SEND_CHAT_NOTICE",
              userName: currentUser?.name || "",
            })
            .catch(() => undefined);

          showView(viewRecording);
          recMeetingName.innerText = currentMeeting.title;
          startTimer(session.startedAt);
          resolve();
        }
      );
    });
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

// Dừng ghi âm
btnStop.onclick = async () => {
  if (!confirm("Bạn có chắc chắn muốn kết thúc và lưu biên bản cuộc họp này?")) return;
  stopTimer();
  showView(viewUploading);

  chrome.runtime.sendMessage({ target: "offscreen", type: "STOP" }, async (res) => {
    chrome.action.setBadgeText({ text: "" });
    await chrome.storage.session.remove("current_recording_session");

    if (res && res.ok) {
      showView(viewSuccess);
      btnOpenMeeting.onclick = async () => {
        const { baseUrl } = await getConfig();
        const meetingId = currentMeeting?.id || res.recap?.meetingId;
        chrome.tabs.create({ url: `${baseUrl}/meetings/${meetingId}/recap` });
      };
    } else {
      alert(`Lỗi khi dừng hoặc tải lên: ${res?.error || "Không rõ lỗi"}`);
      init();
    }
  });
};

init();
