/**
 * myCreative Recorder - Google Meet Content Script
 */

function getMeetCodeFromUrl() {
  const path = window.location.pathname;
  const match = path.match(/\/?([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})/);
  return match ? match[1].toLowerCase() : null;
}

// Báo cho background script biết người dùng đang ở phòng họp Meet nào
let lastReportedCode = null;
function reportMeetCode() {
  const code = getMeetCodeFromUrl();
  if (code && code !== lastReportedCode) {
    lastReportedCode = code;
    chrome.runtime.sendMessage({
      type: "MEET_DETECTED",
      meetCode: code,
      url: window.location.href,
    }).catch(() => undefined);
  }
}

// Theo dõi thay đổi URL (SPA navigation của Meet)
reportMeetCode();
setInterval(reportMeetCode, 2000);

// Phát hiện khi người dùng rời cuộc họp (màn hình "Bạn đã rời khỏi cuộc họp" / "You left the meeting")
function checkMeetingLeft() {
  const bodyText = document.body ? document.body.innerText : "";
  if (
    bodyText.includes("Bạn đã rời khỏi cuộc họp") ||
    bodyText.includes("You left the meeting") ||
    bodyText.includes("Bạn đã thoát cuộc họp") ||
    bodyText.includes("Cuộc họp đã kết thúc")
  ) {
    chrome.runtime.sendMessage({ type: "MEET_LEFT" }).catch(() => undefined);
  }
}
setInterval(checkMeetingLeft, 3000);

/**
 * Gửi thông báo minh bạch vào khung chat của Google Meet
 */
async function sendNoticeToMeetChat(userName) {
  const message = `📝 myCreative đang ghi biên bản cuộc họp này (Người ghi: ${userName || "Thành viên"}).`;

  try {
    // 1. Tìm nút mở khung chat nếu chưa mở
    const chatButton =
      document.querySelector('button[aria-label*="chat" i]') ||
      document.querySelector('button[aria-label*="trò chuyện" i]') ||
      document.querySelector('[data-panel-id="2"]');

    if (chatButton && chatButton.getAttribute("aria-pressed") !== "true") {
      chatButton.click();
      await new Promise((r) => setTimeout(r, 600));
    }

    // 2. Tìm ô nhập tin nhắn chat
    const chatInput =
      document.querySelector('textarea[name="chatTextInput"]') ||
      document.querySelector('textarea[aria-label*="tin nhắn" i]') ||
      document.querySelector('textarea[aria-label*="message" i]') ||
      document.querySelector('[contenteditable="true"]');

    if (!chatInput) {
      console.warn("myCreative: Không tìm thấy ô nhập chat Meet.");
      return false;
    }

    // 3. Nhập tin nhắn
    if (chatInput.tagName === "TEXTAREA") {
      chatInput.value = message;
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      chatInput.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      chatInput.innerText = message;
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    await new Promise((r) => setTimeout(r, 300));

    // 4. Tìm nút gửi
    const sendButton =
      document.querySelector('button[aria-label*="Gửi" i]') ||
      document.querySelector('button[aria-label*="Send" i]') ||
      document.querySelector('button[jsname="soHxf"]');

    if (sendButton && !sendButton.disabled) {
      sendButton.click();
      return true;
    } else {
      // Nhấn phím Enter làm phương án dự phòng
      chatInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
      return true;
    }
  } catch (err) {
    console.warn("myCreative: Gửi thông báo chat gặp lỗi:", err);
    return false;
  }
}

// Lắng nghe yêu cầu từ background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_MEET_CODE") {
    sendResponse({ meetCode: getMeetCodeFromUrl() });
    return false;
  }

  if (message.type === "SEND_CHAT_NOTICE") {
    sendNoticeToMeetChat(message.userName)
      .then((success) => sendResponse({ success }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }
});
