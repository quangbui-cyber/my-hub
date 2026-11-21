/**
 * My Hub Recorder - Content Script cầu nối đồng bộ trực tiếp với ứng dụng My Hub (localhost:3000)
 *
 * Nhiệm vụ:
 * 1. Đồng bộ tài khoản Google đang đăng nhập trên My Hub sang Chrome Extension.
 * 2. Đọc Từ điển AI (glossary) từ localStorage của đúng tài khoản Google trên My Hub.
 * 3. Khi Extension tạo xong biên bản họp AI, đẩy thẳng biên bản vào localStorage của tài khoản hiện tại
 *    và báo cho StoreProvider của My Hub cập nhật giao diện ngay lập tức.
 */
(() => {
  if (window.__myhubSyncBridgeLoaded) return;
  window.__myhubSyncBridgeLoaded = true;

  const BASE_STORAGE_KEY = "my-hub-data-v1";
  const USER_STORAGE_KEY = "my-hub-active-user";

  function getActiveUser() {
    try {
      const raw = window.localStorage.getItem(USER_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function getActiveStorageKey() {
    const user = getActiveUser();
    if (user && user.email) {
      return `${BASE_STORAGE_KEY}:${String(user.email).toLowerCase()}`;
    }
    return BASE_STORAGE_KEY;
  }

  function syncUserToExtension(user) {
    try {
      chrome.runtime
        .sendMessage({
          type: "SYNC_USER_FROM_MYHUB",
          user: user || null,
        })
        .catch(() => undefined);
    } catch {
      // ignore
    }
  }

  // Đồng bộ tài khoản hiện tại ngay khi mở trang My Hub
  syncUserToExtension(getActiveUser());

  // Lắng nghe khi người dùng đăng nhập / đăng xuất Google trên giao diện My Hub
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.type === "MYHUB_USER_AUTH_CHANGED") {
      syncUserToExtension(event.data.user || null);
    }
  });

  function readMyHubData() {
    try {
      const raw = window.localStorage.getItem(getActiveStorageKey());
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function getGlossaryPayload() {
    const data = readMyHubData();
    const list = Array.isArray(data?.glossary) ? data.glossary : [];
    return {
      terms: list
        .filter((g) => g.kind === "TERM" && g.text)
        .map((g) => ({ text: g.text, heardAs: g.heardAs || null })),
      rules: list.filter((g) => g.kind === "RULE" && g.text).map((g) => g.text),
    };
  }

  function saveMeetingToMyHub(meeting) {
    if (!meeting || !meeting.id) return false;
    try {
      const targetKey = getActiveStorageKey();
      const current = readMyHubData() || {
        monthlyBudget: 12000000,
        tasks: [],
        transactions: [],
        projects: [],
        meetings: [],
        glossary: [],
      };
      const meetings = Array.isArray(current.meetings) ? current.meetings : [];
      if (!meetings.some((m) => m.id === meeting.id)) {
        const next = {
          ...current,
          meetings: [meeting, ...meetings],
        };
        window.localStorage.setItem(targetKey, JSON.stringify(next));
      }
      window.postMessage({ type: "MYHUB_EXTENSION_RECAP_SYNC", meeting }, window.location.origin);
      return true;
    } catch (err) {
      console.warn("Không lưu được biên bản vào My Hub localStorage:", err);
      return false;
    }
  }

  try {
    chrome.runtime
      .sendMessage({ type: "FLUSH_UNSYNCED_MEETINGS" })
      .then((res) => {
        if (Array.isArray(res?.meetings)) {
          for (const m of res.meetings) {
            saveMeetingToMyHub(m);
          }
        }
      })
      .catch(() => undefined);
  } catch {
    // ignore
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_MYHUB_GLOSSARY") {
      sendResponse({ ok: true, glossary: getGlossaryPayload(), user: getActiveUser() });
      return false;
    }
    if (message.type === "SYNC_MEETING_TO_MYHUB") {
      const ok = saveMeetingToMyHub(message.meeting);
      sendResponse({ ok });
      return false;
    }
  });
})();
