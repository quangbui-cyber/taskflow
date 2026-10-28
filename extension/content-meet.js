/**
 * myCreative Recorder - Google Meet Content Script
 */

function getMeetCodeFromUrl() {
  // 1. URL pathname & query
  const pathAndSearch = (window.location.pathname || "") + " " + (window.location.search || "");
  const match = pathAndSearch.match(/\b([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})\b/);
  if (match) return match[1].toLowerCase();

  // 1b. Dạng không có dấu gạch ngang (abcdefghij)
  const noDash = (window.location.pathname || "").match(/meet\.google\.com\/(?:_meet\/|lookup\/)?([a-zA-Z]{10})\b/);
  if (noDash) {
    const c = noDash[1].toLowerCase();
    return `${c.slice(0, 3)}-${c.slice(3, 7)}-${c.slice(7)}`;
  }

  // 2. Document title (VD: "Meet – vqf-fshs-dhd" hoặc "vqf-fshs-dhd")
  const titleMatch = (document.title || "").match(/\b([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})\b/);
  if (titleMatch) return titleMatch[1].toLowerCase();

  // 3. Meet DOM elements (các thẻ chứa mã cuộc họp trong Meet)
  const codeEl =
    document.querySelector("[data-meeting-title]") ||
    document.querySelector("[data-unresolved-meeting-id]") ||
    document.querySelector("[data-call-id]") ||
    document.querySelector('[jsname="r4nke"]');
  if (codeEl) {
    const text = codeEl.textContent || codeEl.getAttribute("data-call-id") || "";
    const m = text.match(/\b([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})\b/);
    if (m) return m[1].toLowerCase();
  }

  // 4. Quét chữ hiển thị ở góc giao diện (như trong ảnh chụp: "4:41 PM | vqf-fshs-dhd")
  const bodyText = document.body ? document.body.innerText.slice(0, 4000) : "";
  const bodyMatch = bodyText.match(/\b([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})\b/);
  if (bodyMatch) return bodyMatch[1].toLowerCase();

  return null;
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
