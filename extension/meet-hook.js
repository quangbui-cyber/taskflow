/**
 * myCreative Recorder - Hook chạy trong trang Google Meet (world: MAIN, document_start)
 *
 * Mục đích: biết chắc người dùng còn đang trong cuộc họp hay đã rời/bị kết thúc, mà không phụ thuộc
 * ngôn ngữ giao diện. Khi họp, Meet giữ các RTCPeerConnection; rời họp hoặc host kết thúc thì chúng bị đóng.
 * Hook chỉ đếm số kết nối còn mở và báo cho content-meet.js (isolated world) qua window.postMessage.
 * Không đọc, không chỉnh sửa dữ liệu cuộc gọi.
 */
(() => {
  if (window.__mycreativeMeetHook) return;
  window.__mycreativeMeetHook = true;

  const Native = window.RTCPeerConnection;
  if (typeof Native !== "function") return;

  const tracked = new Set();

  function isOpen(pc) {
    return pc.signalingState !== "closed" && pc.connectionState !== "closed";
  }

  function report() {
    for (const pc of tracked) {
      if (!isOpen(pc)) tracked.delete(pc);
    }
    window.postMessage(
      { source: "mycreative-meet-hook", type: "PC_COUNT", count: tracked.size },
      window.location.origin
    );
  }

  function track(pc) {
    tracked.add(pc);
    pc.addEventListener("connectionstatechange", report);
    pc.addEventListener("signalingstatechange", report);
    report();
  }

  // content-meet.js nạp muộn hơn (document_idle) nên có thể lỡ các báo cáo đầu: cho phép hỏi lại số hiện tại
  window.addEventListener("message", (event) => {
    if (event.source === window && event.data?.source === "mycreative-meet-content" && event.data.type === "REQUEST_COUNT") {
      report();
    }
  });

  // Dùng subclass để instanceof, static method (generateCertificate...) vẫn như bản gốc
  class TrackedPeerConnection extends Native {
    constructor(...args) {
      super(...args);
      try {
        track(this);
      } catch {
        // Không bao giờ để hook làm hỏng cuộc gọi
      }
    }
  }
  window.RTCPeerConnection = TrackedPeerConnection;
  if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = TrackedPeerConnection;

  // pc.close() đặt trạng thái "closed" ngay nhưng không bắn sự kiện nào, nên phải bắt trực tiếp
  const nativeClose = Native.prototype.close;
  Native.prototype.close = function (...args) {
    try {
      return nativeClose.apply(this, args);
    } finally {
      try {
        report();
      } catch {
        // bỏ qua
      }
    }
  };
})();
