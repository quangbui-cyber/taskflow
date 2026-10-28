import {
  checkAuth,
  lookupMeeting,
  createQuickMeeting,
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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  if (!tab || !tab.url) {
    meetingTitle.innerText = "Không tìm thấy tab cuộc họp";
    showView(viewReady);
    return;
  }

  const match = tab.url.match(/meet\.google\.com\/([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})/);
  if (!match) {
    meetCodeBadge.innerText = "Chưa vào Meet";
    meetCodeBadge.style.background = "#f4f4f5";
    meetCodeBadge.style.color = "#71717a";
    meetingTitle.innerText = "Hãy mở tab Google Meet để ghi biên bản 1 click.";
    meetingTime.innerText = "Hoặc chọn cuộc họp hôm nay trong myCreative.";
    btnStart.disabled = true;
    btnStart.style.opacity = "0.5";
    showView(viewReady);
    return;
  }

  currentMeetCode = match[1].toLowerCase();
  meetCodeBadge.innerText = `Meet: ${currentMeetCode}`;

  try {
    const meeting = await lookupMeeting(currentMeetCode);
    if (meeting) {
      currentMeeting = meeting;
      meetingTitle.innerText = meeting.title;
      const start = new Date(meeting.startAt);
      const end = new Date(meeting.endAt);
      const timeStr = `${start.getHours().toString().padStart(2, "0")}:${start.getMinutes().toString().padStart(2, "0")} – ${end.getHours().toString().padStart(2, "0")}:${end.getMinutes().toString().padStart(2, "0")}`;
      meetingTime.innerText = `${timeStr} (Khớp lịch)`;
      btnStart.disabled = false;
      btnStart.style.opacity = "1";
      quickMeetingSection.classList.add("hidden");
    } else {
      currentMeeting = null;
      meetingTitle.innerText = "Chưa có lịch trong myCreative";
      meetingTime.innerText = "Không tìm thấy cuộc họp khớp mã phòng này trong hôm nay.";
      btnStart.disabled = true;
      btnStart.style.opacity = "0.5";
      quickMeetingSection.classList.remove("hidden");
    }
  } catch (err) {
    meetingTitle.innerText = "Không thể tải thông tin cuộc họp";
    meetingTime.innerText = err.message;
  }

  showView(viewReady);
}

// Bắt đầu ghi âm
btnStart.onclick = async () => {
  if (!currentMeeting || !currentTab?.id) return;
  btnStart.disabled = true;
  btnStart.innerHTML = `<span class="spinner"></span> Đang khởi động...`;

  try {
    const bg = await chrome.runtime.getBackgroundPage?.();
    // Gửi message cho background script bắt đầu ghi
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: currentTab.id });

    // Tạo offscreen document nếu chưa có
    const existing = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (existing.length === 0) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: "Ghi âm cuộc họp",
      });
    }

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

          // Gửi thông báo vào chat Meet
          chrome.tabs.sendMessage(currentTab.id, {
            type: "SEND_CHAT_NOTICE",
            userName: currentUser?.name || "",
          }).catch(() => undefined);

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

// Tạo cuộc họp nhanh & Ghi ngay
btnQuickMeeting.onclick = async () => {
  if (!currentTab?.id) return;
  btnQuickMeeting.disabled = true;
  btnQuickMeeting.innerText = "Đang tạo cuộc họp nhanh...";

  try {
    const meeting = await createQuickMeeting({
      title: `Họp Google Meet (${currentMeetCode})`,
      meetingUrl: currentTab.url,
    });
    currentMeeting = meeting;
    meetingTitle.innerText = meeting.title;
    btnStart.disabled = false;
    btnStart.style.opacity = "1";
    quickMeetingSection.classList.add("hidden");
    btnStart.click();
  } catch (err) {
    alert(`Lỗi tạo cuộc họp nhanh: ${err.message}`);
    btnQuickMeeting.disabled = false;
    btnQuickMeeting.innerText = "⚡ Tạo cuộc họp nhanh & Ghi ngay";
  }
};

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
