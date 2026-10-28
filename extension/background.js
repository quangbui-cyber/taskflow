/**
 * myCreative Recorder - Service Worker (Background Script)
 */

import { lookupMeeting, checkAuth } from "./api.js";

const OFFSCREEN_PATH = "offscreen.html";

// Trạng thái phiên ghi âm hiện tại
let activeSession = null;

async function getSession() {
  if (activeSession) return activeSession;
  const data = await chrome.storage.session.get("current_recording_session");
  activeSession = data.current_recording_session || null;
  return activeSession;
}

async function setSession(session) {
  activeSession = session;
  if (session) {
    await chrome.storage.session.set({ current_recording_session: session });
  } else {
    await chrome.storage.session.remove("current_recording_session");
  }
}

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Ghi âm tab cuộc họp và micro để lập biên bản",
  });
}

async function closeOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

function updateBadge(isRecording, text = "") {
  if (isRecording) {
    chrome.action.setBadgeBackgroundColor({ color: "#dc2626" }); // Đỏ
    chrome.action.setBadgeText({ text: text || "REC" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// Bắt đầu ghi âm tab được chọn
export async function startRecordingSession(tabId, meeting) {
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        target: "offscreen",
        type: "START",
        payload: {
          streamId,
          meetingId: meeting.id,
          fileName: `meet_${meeting.meetCode || meeting.id}_${Date.now()}.webm`,
        },
      },
      async (response) => {
        if (!response || !response.ok) {
          reject(new Error(response?.error || "Không thể khởi động ghi âm."));
          return;
        }

        const session = {
          tabId,
          meeting,
          startedAt: Date.now(),
        };
        await setSession(session);
        updateBadge(true, "REC");
        chrome.alarms.create("recording_timer", { periodInMinutes: 0.1 }); // Cập nhật badge mỗi 6s

        // Gửi thông báo minh bạch vào chat Google Meet
        chrome.storage.local.get("mycreative_user", (data) => {
          const userName = data.mycreative_user?.name || "";
          chrome.tabs.sendMessage(tabId, { type: "SEND_CHAT_NOTICE", userName }).catch(() => undefined);
        });

        resolve(session);
      }
    );
  });
}

// Dừng phiên ghi âm
export async function stopRecordingSession() {
  const session = await getSession();
  if (!session) return { ok: false, error: "Không có phiên ghi nào đang chạy." };

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        target: "offscreen",
        type: "STOP",
      },
      async (response) => {
        chrome.alarms.clear("recording_timer");
        updateBadge(false);
        await setSession(null);
        setTimeout(closeOffscreenDocument, 2000);

        if (!response || !response.ok) {
          reject(new Error(response?.error || "Dừng ghi âm thất bại."));
          return;
        }

        resolve(response);
      }
    );
  });
}

// Xử lý phím tắt Alt+Shift+R
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-recording") return;

  const session = await getSession();
  if (session) {
    await stopRecordingSession().catch(console.error);
    return;
  }

  // Nếu chưa ghi, tìm tab đang xem
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url) return;

  const match = tab.url.match(/meet\.google\.com\/([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})/);
  if (!match) {
    // Không phải tab Meet, mở popup cho người dùng chọn
    return;
  }

  const meetCode = match[1].toLowerCase();
  try {
    const meeting = await lookupMeeting(meetCode);
    if (meeting) {
      await startRecordingSession(tab.id, meeting);
    }
  } catch (err) {
    console.error("Lỗi khi tự động kích hoạt ghi âm qua phím tắt:", err);
  }
});

// Cập nhật số phút ghi trên badge
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "recording_timer") return;
  const session = await getSession();
  if (!session) {
    chrome.alarms.clear("recording_timer");
    updateBadge(false);
    return;
  }

  const elapsedMins = Math.floor((Date.now() - session.startedAt) / 60000);
  updateBadge(true, elapsedMins > 0 ? `${elapsedMins}m` : "REC");

  // Giới hạn 225 phút (tối đa của app) -> tự động dừng
  if (elapsedMins >= 225) {
    await stopRecordingSession().catch(console.error);
  }
});

// Khi tab cuộc họp bị đóng -> tự động kết thúc và tải lên
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSession();
  if (session && session.tabId === tabId) {
    console.log("Tab cuộc họp đã bị đóng, tự động lưu bản ghi...");
    await stopRecordingSession().catch(console.error);
  }
});

// Khi người dùng bấm rời khỏi cuộc họp
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "MEET_LEFT") {
    getSession().then((session) => {
      if (session && sender.tab && session.tabId === sender.tab.id) {
        console.log("Phát hiện người dùng rời phòng họp Meet, tự động dừng sau 10s...");
        setTimeout(() => {
          stopRecordingSession().catch(console.error);
        }, 10000);
      }
    });
  }
});
