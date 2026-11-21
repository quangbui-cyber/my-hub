/**
 * My Hub Recorder - Content Script cầu nối đồng bộ trực tiếp với ứng dụng My Hub (localhost:3000)
 *
 * Nhiệm vụ:
 * 1. Đọc Từ điển AI (glossary) từ localStorage của My Hub để gửi kèm khi chép lời Groq Whisper & Gemini.
 * 2. Khi Extension tạo xong biên bản họp AI, đẩy thẳng biên bản vào localStorage (`my-hub-data-v1`)
 *    và báo cho StoreProvider của My Hub cập nhật giao diện ngay lập tức mà không cần tải lại trang!
 */
(() => {
  if (window.__myhubSyncBridgeLoaded) return;
  window.__myhubSyncBridgeLoaded = true;

  const STORAGE_KEY = "my-hub-data-v1";

  function readMyHubData() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
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
      const current = readMyHubData() || {
        monthlyBudget: 12000000,
        tasks: [],
        transactions: [],
        meetings: [],
        glossary: [],
      };
      const meetings = Array.isArray(current.meetings) ? current.meetings : [];
      if (!meetings.some((m) => m.id === meeting.id)) {
        const next = {
          ...current,
          meetings: [meeting, ...meetings],
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
      // Bắn sự kiện cho StoreProvider trên trang cập nhật state React tức thì
      window.postMessage({ type: "MYHUB_EXTENSION_RECAP_SYNC", meeting }, window.location.origin);
      return true;
    } catch (err) {
      console.warn("Không lưu được biên bản vào My Hub localStorage:", err);
      return false;
    }
  }

  // Khi trang My Hub mở lên, kiểm tra xem Extension có biên bản nào đang chờ đồng bộ không
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
      sendResponse({ ok: true, glossary: getGlossaryPayload() });
      return false;
    }
    if (message.type === "SYNC_MEETING_TO_MYHUB") {
      const ok = saveMeetingToMyHub(message.meeting);
      sendResponse({ ok });
      return false;
    }
  });
})();
