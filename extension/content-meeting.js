/**
 * My Hub Recorder - Content Script chạy trong phòng họp Google Meet, Zoom Web & Microsoft Teams
 *
 * Nhiệm vụ:
 * 1. Nhận diện mã phòng và tên cuộc họp hiện tại trên Meet / Zoom / Teams.
 * 2. Theo dõi tín hiệu rời phòng họp / kết thúc cuộc gọi (kết hợp RTCPeerConnection từ meet-hook.js,
 *    nút Rời cuộc gọi trên giao diện, và màn hình "Bạn đã rời khỏi cuộc họp").
 * 3. Tự động gửi thông báo minh bạch vào khung chat (nếu người dùng bật).
 */
(() => {
  if (window.__myhubMeetingContentLoaded) return;
  window.__myhubMeetingContentLoaded = true;

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
      // Extension vừa reload
    }
  }

  function detectCurrentRoom() {
    const host = window.location.hostname.toLowerCase();
    const href = window.location.href;
    const pathAndSearch = (window.location.pathname || "") + " " + (window.location.search || "");

    // 1. GOOGLE MEET
    if (host === "meet.google.com") {
      let code = null;
      const m1 = pathAndSearch.match(/\b([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})\b/);
      if (m1) code = m1[1].toLowerCase();

      if (!code) {
        const noDash = (window.location.pathname || "").match(/\/(?:_meet\/|lookup\/)?([a-zA-Z]{10})\b/);
        if (noDash) {
          const c = noDash[1].toLowerCase();
          code = `${c.slice(0, 3)}-${c.slice(3, 7)}-${c.slice(7)}`;
        }
      }

      if (!code) {
        const titleMatch = (document.title || "").match(/\b([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})\b/);
        if (titleMatch) code = titleMatch[1].toLowerCase();
      }

      if (!code) {
        const codeEl =
          document.querySelector("[data-meeting-title]") ||
          document.querySelector("[data-unresolved-meeting-id]") ||
          document.querySelector("[data-call-id]") ||
          document.querySelector('[jsname="r4nke"]');
        if (codeEl) {
          const text = codeEl.textContent || codeEl.getAttribute("data-call-id") || "";
          const m = text.match(/\b([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})\b/);
          if (m) code = m[1].toLowerCase();
        }
      }

      if (!code) {
        const bodyText = document.body ? document.body.innerText.slice(0, 4000) : "";
        const bodyMatch = bodyText.match(/\b([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})\b/);
        if (bodyMatch) code = bodyMatch[1].toLowerCase();
      }

      if (!code) return null;

      const customTitle =
        document.querySelector("[data-meeting-title]")?.textContent?.trim() ||
        document.title.replace(/^Meet\s*[-–—]\s*/i, "").trim();

      return {
        platform: "meet",
        code,
        url: `https://meet.google.com/${code}`,
        title: customTitle && customTitle !== code ? customTitle : `Họp Google Meet (${code})`,
      };
    }

    // 2. ZOOM
    if (host.endsWith("zoom.us")) {
      const m = /(?:\/j\/|\/s\/|\/w\/|\/wc\/(?:join|start)\/|\/wc\/|\/my\/)([a-zA-Z0-9._-]+)/i.exec(
        window.location.pathname
      );
      let code = m ? m[1] : null;
      if (!code) {
        const bodyText = document.body ? document.body.innerText.slice(0, 3000) : "";
        const idMatch = /\b(\d{3}\s?\d{3,4}\s?\d{3,4})\b/.exec(bodyText);
        if (idMatch) code = idMatch[1].replace(/\s+/g, "");
      }
      if (!code) return null;

      const topicEl =
        document.querySelector(".meeting-topic") ||
        document.querySelector('[aria-label*="Meeting Information" i]') ||
        document.querySelector("h1");
      const rawTitle = (topicEl?.textContent || document.title || "").replace(/\s*[-|]\s*Zoom.*$/i, "").trim();

      return {
        platform: "zoom",
        code,
        url: href,
        title: rawTitle && rawTitle.length >= 3 ? rawTitle : `Họp Zoom (${code})`,
      };
    }

    // 3. MICROSOFT TEAMS
    if (host.endsWith("teams.microsoft.com") || host.endsWith("teams.live.com")) {
      const isMeetPath =
        href.includes("meetup-join") ||
        href.includes("/meet/") ||
        href.includes("meetingjoin") ||
        Boolean(document.querySelector('[data-tid="call-Duration"], [id*="hangup-button"], [data-tid*="hangup"]'));
      if (!isMeetPath) return null;

      let code = "teams-room";
      const liveMeet = /\/meet\/([a-zA-Z0-9_-]+)/i.exec(href);
      if (liveMeet) {
        code = liveMeet[1].slice(0, 14);
      } else {
        const threadMatch = /19(?:%3a|:)meeting_([a-zA-Z0-9_-]+)/i.exec(href);
        if (threadMatch) code = threadMatch[1].slice(0, 10);
      }

      const rawTitle = (document.title || "")
        .replace(/\s*[-|]\s*Microsoft Teams.*$/i, "")
        .trim();

      return {
        platform: "teams",
        code,
        url: href,
        title: rawTitle && rawTitle.length >= 3 ? rawTitle : `Họp Microsoft Teams (${code})`,
      };
    }

    return null;
  }

  let lastReportedKey = null;
  function reportMeetingDetected() {
    if (!extensionAlive()) return;
    const room = detectCurrentRoom();
    if (!room) return;
    const key = `${room.platform}:${room.code}`;
    if (key !== lastReportedKey) {
      lastReportedKey = key;
      send({
        type: "MEETING_ROOM_DETECTED",
        room,
      });
    }
  }

  reportMeetingDetected();
  setInterval(reportMeetingDetected, 2000);

  // ---------------------------------------------------------------------------
  // Phát hiện rời họp / kết thúc họp đa nền tảng (Meet + Zoom + Teams)
  // ---------------------------------------------------------------------------
  const LEFT_SCREEN_RE =
    /you left the meeting|you['’]ve left the meeting|you have left the meeting|the meeting has ended|this meeting has ended|you['’]ve been removed from the meeting|bạn đã rời khỏi cuộc họp|bạn đã rời cuộc họp|bạn đã thoát cuộc họp|cuộc họp đã kết thúc|bạn đã bị xóa khỏi cuộc họp|this meeting has been ended by host|cuộc họp này đã được người chủ trì kết thúc|you have left the call/i;

  const LEAVE_CONTROL_RE =
    /\b(leave|end|hang\s*up)\s*(the\s+)?(call|meeting)?\b|(rời|thoát)\s+(khỏi\s+)?(cuộc gọi|cuộc họp|phòng họp)|kết thúc\s+(cuộc gọi|cuộc họp)/i;

  const CONNECTION_GONE_MS = 10000;
  const CONNECTION_GONE_AFTER_LEAVE_CLICK_MS = 1500;
  const LEAVE_CLICK_WINDOW_MS = 20000;
  const LEFT_SCREEN_CHECK_MS = 2000;

  let peerConnectionCount = null;
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

    if (leftReported && (peerConnectionCount === null || peerConnectionCount > 0)) {
      reportJoined();
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== "myhub-meeting-hook" || data.type !== "PC_COUNT") return;
    peerConnectionCount = data.count;
    if (data.count > 0) {
      hadConnection = true;
      zeroSince = 0;
    }
    evaluateMeetingState();
  });
  window.postMessage({ source: "myhub-meeting-content", type: "REQUEST_COUNT" }, window.location.origin);

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest('button, [role="button"], [role="menuitem"]');
      if (!control) return;
      const label = `${control.getAttribute("aria-label") || ""} ${control.getAttribute("data-tooltip") || ""} ${
        control.getAttribute("title") || ""
      } ${control.id || ""} ${control.textContent || ""}`;
      if (
        LEAVE_CONTROL_RE.test(label) ||
        (control.textContent || "").includes("call_end") ||
        control.id.includes("hangup") ||
        control.className.toString().includes("footer-button__leave")
      ) {
        leaveClickAt = Date.now();
        setTimeout(evaluateMeetingState, CONNECTION_GONE_AFTER_LEAVE_CLICK_MS + 200);
      }
    },
    true
  );

  setInterval(evaluateMeetingState, 1000);

  /**
   * Gửi thông báo minh bạch vào khung chat Google Meet (nếu đang ở Meet)
   */
  async function sendNoticeToChat(userName) {
    if (window.location.hostname !== "meet.google.com") return false;
    const message = `📝 My Hub Recorder đang ghi biên bản cuộc họp này${userName ? ` (${userName})` : ""}.`;
    try {
      const chatButton =
        document.querySelector('button[aria-label*="chat" i]') ||
        document.querySelector('button[aria-label*="trò chuyện" i]') ||
        document.querySelector('[data-panel-id="2"]');

      if (chatButton && chatButton.getAttribute("aria-pressed") !== "true") {
        chatButton.click();
        await new Promise((r) => setTimeout(r, 600));
      }

      const chatInput =
        document.querySelector('textarea[name="chatTextInput"]') ||
        document.querySelector('textarea[aria-label*="tin nhắn" i]') ||
        document.querySelector('textarea[aria-label*="message" i]') ||
        document.querySelector('[contenteditable="true"]');

      if (!chatInput) return false;

      if (chatInput.tagName === "TEXTAREA") {
        chatInput.value = message;
        chatInput.dispatchEvent(new Event("input", { bubbles: true }));
        chatInput.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        chatInput.innerText = message;
        chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      }

      await new Promise((r) => setTimeout(r, 300));

      const sendButton =
        document.querySelector('button[aria-label*="Gửi" i]') ||
        document.querySelector('button[aria-label*="Send" i]') ||
        document.querySelector('button[jsname="soHxf"]');

      if (sendButton && !sendButton.disabled) {
        sendButton.click();
        return true;
      }
      chatInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_MEETING_ROOM") {
      sendResponse({ room: detectCurrentRoom() });
      return false;
    }
    if (message.type === "SEND_CHAT_NOTICE") {
      sendNoticeToChat(message.userName)
        .then((success) => sendResponse({ success }))
        .catch(() => sendResponse({ success: false }));
      return true;
    }
  });
})();
