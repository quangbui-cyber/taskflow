/**
 * myCreative Recorder - Google Meet Content Script
 */
(() => {
  // Tab Meet mở sẵn trước khi cài/cập nhật extension được nạp bổ sung qua scripting: không chạy hai lần
  if (window.__mycreativeMeetLoaded) return;
  window.__mycreativeMeetLoaded = true;

  function extensionAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function send(message) {
    if (!extensionAlive()) return;
    try {
      chrome.runtime.sendMessage(message).catch(() => undefined);
    } catch {
      // Extension vừa được cập nhật/gỡ, script cũ này không còn liên lạc được nữa
    }
  }

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
    if (!extensionAlive()) return;
    const code = getMeetCodeFromUrl();
    if (code && code !== lastReportedCode) {
      lastReportedCode = code;
      send({
        type: "MEET_DETECTED",
        meetCode: code,
        url: window.location.href,
      });
    }
  }

  // Theo dõi thay đổi URL (SPA navigation của Meet)
  reportMeetCode();
  setInterval(reportMeetCode, 2000);

  // ---------------------------------------------------------------------------
  // Phát hiện rời họp / kết thúc họp. Ba tín hiệu, tín hiệu nào đến trước thì báo:
  //  1. Số RTCPeerConnection còn mở về 0 (meet-hook.js): không phụ thuộc ngôn ngữ, bắt được cả
  //     trường hợp host kết thúc họp cho mọi người hay bị mời ra khỏi phòng.
  //  2. Màn hình sau cuộc gọi ("Bạn đã rời khỏi cuộc họp"...): tín hiệu dự phòng khi hook không chạy.
  //  3. Người dùng bấm nút Rời / Kết thúc cuộc gọi: chỉ rút ngắn thời gian chờ ở (1), không tự quyết định,
  //     vì bấm vào mũi tên menu hay bấm rồi huỷ hộp thoại xác nhận thì vẫn còn trong họp.
  // ---------------------------------------------------------------------------

  const LEFT_SCREEN_RE =
    /you left the meeting|you['’]ve left the meeting|you have left the meeting|the meeting has ended|this meeting has ended|you['’]ve been removed from the meeting|bạn đã rời khỏi cuộc họp|bạn đã rời cuộc họp|bạn đã thoát cuộc họp|cuộc họp đã kết thúc|bạn đã bị xóa khỏi cuộc họp/i;

  const LEAVE_CONTROL_RE =
    /\b(leave|end)\s+(the\s+)?(call|meeting)\b|(rời|thoát)\s+(khỏi\s+)?(cuộc gọi|cuộc họp)|kết thúc\s+(cuộc gọi|cuộc họp)/i;

  // Mất kết nối Meet có thể kéo dài vài giây rồi tự nối lại, nên nếu chỉ dựa vào số kết nối thì phải chờ lâu hơn
  const CONNECTION_GONE_MS = 10000;
  const CONNECTION_GONE_AFTER_LEAVE_CLICK_MS = 1500;
  const LEAVE_CLICK_WINDOW_MS = 20000;
  const LEFT_SCREEN_CHECK_MS = 2000;

  let peerConnectionCount = null; // null = chưa nhận được báo cáo nào từ meet-hook.js
  let hadConnection = false;
  let zeroSince = 0;
  let leaveClickAt = 0;
  let leftReported = false;
  let lastScreenCheckAt = 0;
  let lastScreenResult = false;

  function leftScreenVisible(now) {
    if (now - lastScreenCheckAt >= LEFT_SCREEN_CHECK_MS) {
      lastScreenCheckAt = now;
      const text = document.body ? document.body.innerText : "";
      lastScreenResult = LEFT_SCREEN_RE.test(text);
    }
    return lastScreenResult;
  }

  function reportLeft(reason) {
    if (leftReported) return;
    leftReported = true;
    // Lần vào họp tiếp theo phải có kết nối mới thì mới tính lại
    hadConnection = false;
    zeroSince = 0;
    send({ type: "MEET_LEFT", reason });
  }

  function reportJoined() {
    if (!leftReported) return;
    leftReported = false;
    send({ type: "MEET_JOINED" });
  }

  function evaluateMeetingState() {
    if (!extensionAlive()) return;
    const now = Date.now();
    const onLeftScreen = leftScreenVisible(now);

    let connectionGone = false;
    if (peerConnectionCount === 0 && hadConnection) {
      if (!zeroSince) zeroSince = now;
      const needed =
        now - leaveClickAt < LEAVE_CLICK_WINDOW_MS ? CONNECTION_GONE_AFTER_LEAVE_CLICK_MS : CONNECTION_GONE_MS;
      connectionGone = now - zeroSince >= needed;
    } else {
      zeroSince = 0;
    }

    if (onLeftScreen || connectionGone) {
      reportLeft(onLeftScreen ? "left-screen" : "connection-closed");
      return;
    }

    // Vào lại phòng (bấm "Tham gia lại") trong thời gian chờ: huỷ lệnh tự kết thúc
    if (leftReported && (peerConnectionCount === null || peerConnectionCount > 0)) {
      reportJoined();
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== "mycreative-meet-hook" || data.type !== "PC_COUNT") return;
    peerConnectionCount = data.count;
    if (data.count > 0) {
      hadConnection = true;
      zeroSince = 0;
    }
    evaluateMeetingState();
  });
  window.postMessage({ source: "mycreative-meet-content", type: "REQUEST_COUNT" }, window.location.origin);

  // Bấm nút Rời cuộc gọi / Kết thúc cuộc gọi (nút đỏ có icon call_end, hoặc mục menu "Kết thúc cuộc gọi cho tất cả")
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest('button, [role="button"], [role="menuitem"]');
      if (!control) return;
      const label = `${control.getAttribute("aria-label") || ""} ${control.getAttribute("data-tooltip") || ""} ${control.textContent || ""}`;
      if (LEAVE_CONTROL_RE.test(label) || (control.textContent || "").includes("call_end")) {
        leaveClickAt = Date.now();
        setTimeout(evaluateMeetingState, CONNECTION_GONE_AFTER_LEAVE_CLICK_MS + 200);
      }
    },
    true
  );

  setInterval(evaluateMeetingState, 1000);

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
})();
