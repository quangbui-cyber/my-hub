/**
 * My Hub Recorder - Hook chạy trong trang Google Meet, Zoom Web & Microsoft Teams (world: MAIN, document_start)
 *
 * Mục đích: biết chắc người dùng còn đang trong cuộc họp hay đã rời/bị kết thúc, mà không phụ thuộc
 * ngôn ngữ giao diện. Khi họp, ứng dụng giữ các RTCPeerConnection; rời họp hoặc host kết thúc thì chúng bị đóng.
 * Hook chỉ đếm số kết nối còn mở và báo cho content-meeting.js (isolated world) qua window.postMessage.
 */
(() => {
  if (window.__myhubMeetingHook) return;
  window.__myhubMeetingHook = true;

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
      { source: "myhub-meeting-hook", type: "PC_COUNT", count: tracked.size },
      window.location.origin
    );
  }

  function track(pc) {
    tracked.add(pc);
    pc.addEventListener("connectionstatechange", report);
    pc.addEventListener("signalingstatechange", report);
    report();
  }

  window.addEventListener("message", (event) => {
    if (
      event.source === window &&
      event.data?.source === "myhub-meeting-content" &&
      event.data.type === "REQUEST_COUNT"
    ) {
      report();
    }
  });

  class TrackedPeerConnection extends Native {
    constructor(...args) {
      super(...args);
      try {
        track(this);
      } catch {
        // Không làm ảnh hưởng cuộc gọi
      }
    }
  }
  window.RTCPeerConnection = TrackedPeerConnection;
  if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = TrackedPeerConnection;

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
