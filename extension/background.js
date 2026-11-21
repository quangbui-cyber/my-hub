/**
 * My Hub Recorder - Service Worker (Background Script)
 *
 * Quản lý:
 * 1. Tự động bắt link Meet / Zoom / Teams từ mọi trang web đang xem (content-scanner.js) và lưu lịch sử.
 * 2. Nhận diện khi người dùng vào phòng họp Meet / Zoom / Teams (content-meeting.js).
 * 3. Vòng đời phiên ghi âm 1-click (recording -> uploading -> done | failed) qua Offscreen Document.
 * 4. Tự động dừng ghi âm khi rời phòng họp, đóng tab, chuyển trang hoặc nhấn Alt+Shift+R.
 * 5. Đồng bộ biên bản AI trực tiếp vào ứng dụng My Hub (localhost:3000) và cho phép tải file .webm về máy.
 */

import { getConfig } from "./api.js";
import {
  extractAllMeetingLinks,
  detectActiveMeetingFromTabUrl,
  PLATFORM_META,
} from "./meetingLinks.js";

const OFFSCREEN_PATH = "offscreen.html";
const SESSION_KEY = "current_recording_session"; // chrome.storage.session
const PENDING_KEY = "myhub_pending_upload"; // chrome.storage.local
const DETECTED_LINKS_KEY = "myhub_detected_links"; // chrome.storage.local (lịch sử link đã bắt)
const TAB_LINKS_KEY = "myhub_tab_links"; // chrome.storage.session (link theo từng tab)
const UNSYNCED_MEETINGS_KEY = "myhub_unsynced_meetings"; // chrome.storage.local
const TIMER_ALARM = "recording_timer";
const MAX_RECORDING_MINUTES = 225;
const LEAVE_GRACE_MS = 5000;

const END_REASON_LABEL = {
  manual: "Bạn đã bấm dừng",
  "tab-closed": "Tab cuộc họp đã đóng",
  "tab-capture-ended": "Tab cuộc họp đã đóng hoặc chuyển trang",
  navigated: "Tab đã rời khỏi cuộc họp",
  "left-meeting": "Bạn đã rời cuộc họp",
  "max-duration": "Đã đạt thời lượng tối đa",
  retry: "Gửi lại bản ghi",
};

let leaveTimer = null;
let endInFlight = null;

// ---------- Quản lý trạng thái phiên ghi ----------

async function getSession() {
  const data = await chrome.storage.session.get(SESSION_KEY);
  return data[SESSION_KEY] || null;
}

async function setSession(session) {
  if (session) {
    await chrome.storage.session.set({ [SESSION_KEY]: session });
  } else {
    await chrome.storage.session.remove(SESSION_KEY);
  }
}

async function patchSession(patch) {
  const session = await getSession();
  if (!session) return null;
  const next = { ...session, ...patch };
  await setSession(next);
  return next;
}

async function getPending() {
  const data = await chrome.storage.local.get(PENDING_KEY);
  return data[PENDING_KEY] || null;
}

// ---------- Quản lý danh sách Link Meet / Zoom / Teams bắt được ----------

export async function getDetectedLinksHistory() {
  const data = await chrome.storage.local.get(DETECTED_LINKS_KEY);
  return Array.isArray(data[DETECTED_LINKS_KEY]) ? data[DETECTED_LINKS_KEY] : [];
}

async function saveDetectedLinksToHistory(newLinks) {
  if (!Array.isArray(newLinks) || newLinks.length === 0) return [];
  const current = await getDetectedLinksHistory();
  const byKey = new Map();

  for (const item of current) {
    if (item && item.key) byKey.set(item.key, item);
  }

  for (const link of newLinks) {
    const key = link.key || `${link.platform}:${link.code}`;
    const existing = byKey.get(key);
    byKey.set(key, {
      ...existing,
      ...link,
      key,
      contextTitle: link.contextTitle || existing?.contextTitle || link.title || "",
      detectedAt: Date.now(),
    });
  }

  const merged = Array.from(byKey.values())
    .sort((a, b) => (b.detectedAt || 0) - (a.detectedAt || 0))
    .slice(0, 40);

  await chrome.storage.local.set({ [DETECTED_LINKS_KEY]: merged });
  return merged;
}

async function setTabScannedLinks(tabId, links) {
  if (!tabId) return;
  const data = await chrome.storage.session.get(TAB_LINKS_KEY);
  const map = data[TAB_LINKS_KEY] || {};
  map[tabId] = links;
  await chrome.storage.session.set({ [TAB_LINKS_KEY]: map });
  await updateIdleBadgeForTab(tabId, links.length);
}

export async function getTabScannedLinks(tabId) {
  if (!tabId) return [];
  const data = await chrome.storage.session.get(TAB_LINKS_KEY);
  const map = data[TAB_LINKS_KEY] || {};
  return Array.isArray(map[tabId]) ? map[tabId] : [];
}

async function updateIdleBadgeForTab(tabId, linkCount) {
  const session = await getSession();
  // Nếu đang ghi hoặc đang tải lên thì ưu tiên badge REC / ↑
  if (session?.phase === "recording" || session?.phase === "uploading") return;
  const pending = await getPending();
  if (pending && session?.phase === "failed") return;

  try {
    const tab = await chrome.tabs.get(tabId);
    const activeRoom = detectActiveMeetingFromTabUrl(tab.url || "", tab.title || "");
    if (activeRoom) {
      chrome.action.setBadgeText({ tabId, text: "LIVE" });
      chrome.action.setBadgeBackgroundColor({ tabId, color: "#059669" });
      return;
    }
  } catch {
    return;
  }

  if (linkCount > 0) {
    chrome.action.setBadgeText({ tabId, text: String(linkCount) });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
  } else {
    chrome.action.setBadgeText({ tabId, text: "" });
  }
}

// ---------- Offscreen Document ----------

async function hasOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return existing.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.BLOBS],
    justification: "Ghi âm tab cuộc họp (Meet/Zoom/Teams) + micro và xuất file ghi âm .webm",
  });
}

function sendToOffscreen(type, payload) {
  return chrome.runtime.sendMessage({ target: "offscreen", type, payload });
}

// ---------- Badge & Thông báo ----------

function setGlobalBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

const BADGE_RED = "#dc2626";
const BADGE_AMBER = "#d97706";

function showNotification(id, title, message) {
  try {
    chrome.notifications.create(id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message,
      priority: 1,
    });
  } catch (err) {
    console.warn("Không hiện được thông báo:", err);
  }
}

// ---------- Cầu nối đồng bộ với My Hub (localhost:3000) ----------

async function fetchGlossaryFromMyHubTabs() {
  try {
    const tabs = await chrome.tabs.query({
      url: ["http://localhost:3000/*", "http://127.0.0.1:3000/*"],
    });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: "GET_MYHUB_GLOSSARY" });
        if (res?.ok && res.glossary) return res.glossary;
      } catch {
        // tab chưa nạp content script
      }
    }
  } catch {
    // ignore
  }
  return { terms: [], rules: [] };
}

function buildMyHubMeetingRecord(sessionMeeting, recapData, fileName, durationSeconds) {
  const id = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const rawAttendees = sessionMeeting?.attendees || "";
  const attendeesList = Array.isArray(rawAttendees)
    ? rawAttendees
    : String(rawAttendees)
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);

  const actionItems = (recapData?.actionItems || []).map((item, idx) => ({
    id: `${Date.now()}-${idx}`,
    title: item.task || item.title || "",
    task: item.task || item.title || "",
    owner: item.owner || "Chưa rõ",
    due: item.due || "Chưa rõ",
    dueDate: item.dueDate || "",
    done: false,
    pushedToTask: false,
  }));

  return {
    id,
    title: recapData?.title || sessionMeeting?.title || "Biên bản cuộc họp",
    date: new Date().toISOString(),
    summary: recapData?.summary || (recapData?.overview || []).join(" "),
    overview: recapData?.overview || [],
    topics: recapData?.topics || [],
    decisions: recapData?.decisions || [],
    actionItems,
    openQuestions: recapData?.openQuestions || [],
    content: recapData?.content || "",
    transcript: recapData?.transcript || "",
    attendees: attendeesList,
    audioName: recapData?.audioName || fileName || null,
    audioSeconds: recapData?.audioSeconds || durationSeconds || null,
    meetingUrl: sessionMeeting?.url || null,
    platform: sessionMeeting?.platform || null,
    meetingCode: sessionMeeting?.code || null,
    fromExtension: true,
    glossarySuggestions: [],
  };
}

async function syncMeetingRecordToMyHub(meetingRecord) {
  let syncedToOpenTab = false;
  try {
    const tabs = await chrome.tabs.query({
      url: ["http://localhost:3000/*", "http://127.0.0.1:3000/*"],
    });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: "SYNC_MEETING_TO_MYHUB",
          meeting: meetingRecord,
        });
        if (res?.ok) syncedToOpenTab = true;
      } catch {
        // Thử tiêm content-myhub.js nếu tab đã mở từ trước
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content-myhub.js"],
          });
          const res2 = await chrome.tabs.sendMessage(tab.id, {
            type: "SYNC_MEETING_TO_MYHUB",
            meeting: meetingRecord,
          });
          if (res2?.ok) syncedToOpenTab = true;
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  // Nếu chưa có tab My Hub nào đang mở, lưu vào hàng đợi để ngay khi mở My Hub lên sẽ tự nạp vào
  if (!syncedToOpenTab) {
    const data = await chrome.storage.local.get(UNSYNCED_MEETINGS_KEY);
    const queue = Array.isArray(data[UNSYNCED_MEETINGS_KEY]) ? data[UNSYNCED_MEETINGS_KEY] : [];
    queue.unshift(meetingRecord);
    await chrome.storage.local.set({ [UNSYNCED_MEETINGS_KEY]: queue.slice(0, 30) });
  }

  return syncedToOpenTab;
}

// ---------- Bắt đầu phiên ghi âm ----------

export async function startRecordingSession({ tabId, streamId, meeting }) {
  const current = await getSession();
  if (current?.phase === "recording") {
    throw new Error("Đang có một phiên ghi âm khác đang chạy.");
  }
  if (current?.phase === "uploading") {
    throw new Error("Bản ghi trước đang được AI xử lý, vui lòng đợi trong giây lát.");
  }

  const finalStreamId = streamId || (await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }));
  await ensureOffscreenDocument();
  const config = await getConfig();
  const glossary = await fetchGlossaryFromMyHubTabs();
  const startedAt = Date.now();

  const vn = new Date(startedAt + 7 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}-${pad(
    vn.getUTCHours()
  )}${pad(vn.getUTCMinutes())}`;
  const platformSlug = meeting?.platform || "meet";
  const codeSlug = (meeting?.code || "room").replace(/[^a-zA-Z0-9_-]/g, "");
  const fileName = `ghi-am-${platformSlug}-${codeSlug}-${stamp}.webm`;

  const normalizedMeeting = {
    id: meeting?.id || `m_${startedAt}`,
    platform: meeting?.platform || "meet",
    code: meeting?.code || "room",
    url: meeting?.url || "",
    title: meeting?.title || `Họp ${PLATFORM_META[meeting?.platform]?.name || "Online"} (${meeting?.code || ""})`,
    attendees: meeting?.attendees || config.defaultAttendees || "",
  };

  const response = await sendToOffscreen("START", {
    streamId: finalStreamId,
    meeting: normalizedMeeting,
    fileName,
    baseUrl: config.baseUrl,
    glossary,
  });

  if (!response || !response.ok) {
    throw new Error(response?.error || "Không thể khởi động ghi âm.");
  }

  const session = {
    phase: "recording",
    tabId,
    meeting: normalizedMeeting,
    fileName,
    startedAt,
  };
  await setSession(session);
  await chrome.storage.local.set({
    [PENDING_KEY]: {
      meeting: normalizedMeeting,
      fileName,
      startedAt,
    },
  });

  // Lưu link phòng họp này vào danh sách đã bắt
  await saveDetectedLinksToHistory([
    {
      platform: normalizedMeeting.platform,
      code: normalizedMeeting.code,
      url: normalizedMeeting.url,
      label: `${PLATFORM_META[normalizedMeeting.platform]?.shortName || "Meet"}: ${normalizedMeeting.code}`,
      contextTitle: normalizedMeeting.title,
    },
  ]);

  setGlobalBadge("REC", BADGE_RED);
  chrome.alarms.create(TIMER_ALARM, { periodInMinutes: 0.5 });

  // Gửi thông báo minh bạch vào chat Google Meet (nếu được bật)
  if (config.sendChatNotice && normalizedMeeting.platform === "meet") {
    chrome.tabs
      .sendMessage(tabId, { type: "SEND_CHAT_NOTICE", userName: config.userName })
      .catch(() => undefined);
  }

  return session;
}

// ---------- Kết thúc phiên ghi âm ----------

export function endSession(reason) {
  if (endInFlight) return endInFlight;

  endInFlight = (async () => {
    clearTimeout(leaveTimer);
    leaveTimer = null;

    const session = await getSession();
    if (!session || session.phase !== "recording") {
      return { ok: false, error: "Không có phiên ghi nào đang chạy." };
    }

    await patchSession({ phase: "uploading", endReason: reason, endedAt: Date.now() });
    chrome.alarms.clear(TIMER_ALARM);
    setGlobalBadge("↑", BADGE_AMBER);

    let response;
    try {
      response = await sendToOffscreen("STOP", { reason });
    } catch (err) {
      response = { ok: false, error: err.message };
    }

    if (!response?.ok && (await getSession())?.phase === "uploading") {
      await failSession(response?.error || "Dừng ghi âm thất bại.");
    }
    return response || { ok: false };
  })().finally(() => {
    endInFlight = null;
  });

  return endInFlight;
}

async function completeSession({ recap, fileName, durationSeconds, size }) {
  const session = await getSession();
  const meetingInfo = session?.meeting || { title: "Cuộc họp" };

  // Chuyển kết quả từ /api/recap thành bản ghi Meeting của My Hub và đồng bộ thẳng vào My Hub
  const meetingRecord = buildMyHubMeetingRecord(
    meetingInfo,
    recap,
    fileName || session?.fileName,
    durationSeconds
  );
  await syncMeetingRecordToMyHub(meetingRecord);

  await chrome.storage.local.remove(PENDING_KEY);
  await patchSession({
    phase: "done",
    finishedAt: Date.now(),
    fileName: fileName || session?.fileName,
    durationSeconds,
    size,
    recapSummary: {
      id: meetingRecord.id,
      title: meetingRecord.title,
      summary: meetingRecord.summary,
      actionCount: meetingRecord.actionItems?.length || 0,
    },
  });
  setGlobalBadge("");

  showNotification(
    `recap-ok:${meetingRecord.id}`,
    "Đã tạo xong biên bản họp AI!",
    `${meetingRecord.title} (${END_REASON_LABEL[session?.endReason] || "đã kết thúc"}). Bấm để mở xem trên My Hub.`
  );
}

async function failSession(error, extra = {}) {
  const pending = await getPending();
  const session = await getSession();
  const nextPending = {
    ...(pending || {
      meeting: session?.meeting,
      fileName: extra.fileName || session?.fileName,
      startedAt: session?.startedAt || Date.now(),
    }),
    error,
    durationSeconds: extra.durationSeconds,
    size: extra.size,
  };
  await chrome.storage.local.set({ [PENDING_KEY]: nextPending });
  await patchSession({
    phase: "failed",
    error,
    finishedAt: Date.now(),
    fileName: nextPending.fileName,
    durationSeconds: extra.durationSeconds,
    size: extra.size,
  });
  chrome.alarms.clear(TIMER_ALARM);
  setGlobalBadge("!", BADGE_RED);

  showNotification(
    "recap-failed",
    "Bản ghi âm đã lưu trên máy (chưa tạo biên bản AI)",
    `${session?.meeting?.title || pending?.meeting?.title || "Cuộc họp"}: ${error}. Mở Extension để Tải file .webm về máy hoặc Thử gửi lại.`
  );
}

export async function retryPendingUpload() {
  const pending = await getPending();
  if (!pending) throw new Error("Không có bản ghi nào đang chờ xử lý.");

  const current = await getSession();
  if (current?.phase === "recording" || current?.phase === "uploading") {
    throw new Error("Đang có phiên ghi hoặc đang xử lý.");
  }

  await ensureOffscreenDocument();
  const config = await getConfig();
  const glossary = await fetchGlossaryFromMyHubTabs();

  await setSession({
    phase: "uploading",
    tabId: null,
    meeting: pending.meeting,
    fileName: pending.fileName,
    startedAt: pending.startedAt,
    endReason: "retry",
  });
  setGlobalBadge("↑", BADGE_AMBER);

  const response = await sendToOffscreen("RETRY_UPLOAD", {
    meeting: pending.meeting,
    fileName: pending.fileName,
    startedAt: pending.startedAt,
    baseUrl: config.baseUrl,
    glossary,
  });

  if (!response?.ok) {
    await failSession(response?.error || "Không gửi lại được bản ghi.");
    throw new Error(response?.error || "Không gửi lại được bản ghi.");
  }
}

async function discardPending() {
  await chrome.storage.local.remove(PENDING_KEY);
  await setSession(null);
  setGlobalBadge("");
  if (await hasOffscreenDocument()) {
    await sendToOffscreen("CLEAR_CHUNKS", {}).catch(() => undefined);
  }
}

// ---------- Các tín hiệu tự động kết thúc cuộc họp ----------

// 1. Đóng tab cuộc họp
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSession();
  if (session?.phase === "recording" && session.tabId === tabId) {
    await endSession("tab-closed").catch(console.error);
  }
});

// 2. Tab chuyển sang trang khác (không còn ở phòng họp này)
function isSameMeetingTabUrl(url, meeting) {
  if (!url || !meeting) return true;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  const host = parsed.hostname.toLowerCase();
  if (meeting.platform === "meet") {
    if (host !== "meet.google.com") return false;
    if (!meeting.code) return true;
    const clean = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    return clean(parsed.pathname).includes(clean(meeting.code));
  }
  if (meeting.platform === "zoom") {
    return host.endsWith("zoom.us");
  }
  if (meeting.platform === "teams") {
    return host.endsWith("teams.microsoft.com") || host.endsWith("teams.live.com");
  }
  return true;
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const session = await getSession();
  if (session?.phase !== "recording" || session.tabId !== tabId) return;
  if (!isSameMeetingTabUrl(changeInfo.url, session.meeting)) {
    await endSession("navigated").catch(console.error);
  }
});

// 3. Rời cuộc họp / host kết thúc cuộc họp (content-meeting.js báo về)
async function handleMeetLeft(sender) {
  const session = await getSession();
  if (session?.phase !== "recording" || !sender.tab || session.tabId !== sender.tab.id) return;
  if (leaveTimer) return;
  leaveTimer = setTimeout(() => {
    leaveTimer = null;
    endSession("left-meeting").catch(console.error);
  }, LEAVE_GRACE_MS);
}

function handleMeetJoined(sender) {
  if (!leaveTimer) return;
  getSession().then((session) => {
    if (session && sender.tab && session.tabId === sender.tab.id) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  });
}

// 4. Đồng hồ cập nhật badge thời gian ghi & kiểm tra an toàn
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TIMER_ALARM) return;
  const session = await getSession();
  if (session?.phase !== "recording") {
    chrome.alarms.clear(TIMER_ALARM);
    return;
  }

  const elapsedMins = Math.floor((Date.now() - session.startedAt) / 60000);
  setGlobalBadge(elapsedMins > 0 ? `${elapsedMins}m` : "REC", BADGE_RED);

  if (elapsedMins >= MAX_RECORDING_MINUTES) {
    await endSession("max-duration").catch(console.error);
    return;
  }

  try {
    await chrome.tabs.get(session.tabId);
  } catch {
    await endSession("tab-closed").catch(console.error);
    return;
  }

  if (!(await hasOffscreenDocument())) {
    await failSession("Trình ghi âm đã bị trình duyệt đóng bất ngờ.");
  }
});

// ---------- Phím tắt Alt+Shift+R ----------

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-recording") return;

  const session = await getSession();
  if (session?.phase === "recording") {
    await endSession("manual").catch(console.error);
    return;
  }
  if (session?.phase === "uploading") return;

  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
  }
  if (!tab || !tab.id) return;

  const room = detectActiveMeetingFromTabUrl(tab.url || "", tab.title || "");
  if (!room) return;

  try {
    await startRecordingSession({ tabId: tab.id, meeting: room });
  } catch (err) {
    console.error("Lỗi khi kích hoạt ghi âm qua phím tắt:", err);
  }
});

// ---------- Xử lý Tin nhắn ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_CONFIG") {
    getConfig().then(sendResponse);
    return true;
  }

  // Từ content-scanner.js: Trang web vừa quét được các link Meet / Zoom / Teams
  if (message.type === "PAGE_LINKS_SCANNED") {
    const tabId = sender.tab?.id;
    const links = extractAllMeetingLinks(message.payload || {});
    Promise.all([
      setTabScannedLinks(tabId, links),
      saveDetectedLinksToHistory(links),
    ])
      .then(([, history]) => sendResponse({ ok: true, count: links.length, historyCount: history.length }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  // Từ content-meeting.js: Người dùng vừa vào phòng họp Meet / Zoom / Teams
  if (message.type === "MEETING_ROOM_DETECTED" && message.room) {
    const tabId = sender.tab?.id;
    const room = message.room;
    saveDetectedLinksToHistory([
      {
        platform: room.platform,
        code: room.code,
        url: room.url,
        label: `${PLATFORM_META[room.platform]?.shortName || "Meet"}: ${room.code}`,
        contextTitle: room.title,
      },
    ]).catch(() => undefined);
    if (tabId) updateIdleBadgeForTab(tabId, 1).catch(() => undefined);
    return false;
  }

  // Từ content-myhub.js: Khi trang My Hub mở lên, đẩy hết các biên bản chưa đồng bộ vào My Hub
  if (message.type === "FLUSH_UNSYNCED_MEETINGS") {
    chrome.storage.local.get(UNSYNCED_MEETINGS_KEY).then(async (data) => {
      const meetings = Array.isArray(data[UNSYNCED_MEETINGS_KEY]) ? data[UNSYNCED_MEETINGS_KEY] : [];
      if (meetings.length > 0) {
        await chrome.storage.local.remove(UNSYNCED_MEETINGS_KEY);
      }
      sendResponse({ ok: true, meetings });
    });
    return true;
  }

  // Từ Popup: Lấy danh sách link của tab hiện tại + lịch sử link
  if (message.type === "GET_DETECTED_LINKS") {
    Promise.all([
      getTabScannedLinks(message.tabId),
      getDetectedLinksHistory(),
    ]).then(([tabLinks, historyLinks]) => {
      sendResponse({ ok: true, tabLinks, historyLinks });
    });
    return true;
  }

  if (message.type === "SAVE_DETECTED_LINKS") {
    Promise.all([
      message.tabId ? setTabScannedLinks(message.tabId, message.links || []) : Promise.resolve(),
      saveDetectedLinksToHistory(message.links || []),
    ]).then(([, historyLinks]) => {
      sendResponse({ ok: true, historyLinks });
    });
    return true;
  }

  if (message.type === "CLEAR_LINK_HISTORY") {
    chrome.storage.local.remove(DETECTED_LINKS_KEY).then(() => sendResponse({ ok: true }));
    return true;
  }

  // Từ Popup: Điều khiển phiên ghi âm
  if (message.type === "START_SESSION") {
    startRecordingSession(message.payload)
      .then((session) => sendResponse({ ok: true, session }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "STOP_SESSION") {
    endSession("manual").then(sendResponse);
    return true;
  }

  if (message.type === "RETRY_UPLOAD") {
    retryPendingUpload()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "DISCARD_PENDING") {
    discardPending().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "REQUEST_DOWNLOAD_RECORDING") {
    ensureOffscreenDocument()
      .then(() => sendToOffscreen("GET_DOWNLOAD_URL", {}))
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // Từ content-meeting.js: Rời hoặc vào lại phòng họp
  if (message.type === "MEET_LEFT") {
    handleMeetLeft(sender);
    return false;
  }

  if (message.type === "MEET_JOINED") {
    handleMeetJoined(sender);
    return false;
  }

  // Từ offscreen.js
  if (message.type === "RECORDING_STOPPED") {
    getSession().then(async (session) => {
      if (session?.phase !== "recording") return;
      clearTimeout(leaveTimer);
      leaveTimer = null;
      await patchSession({
        phase: "uploading",
        endReason: message.reason,
        endedAt: Date.now(),
        fileName: message.fileName || session.fileName,
        durationSeconds: message.durationSeconds,
        size: message.size,
      });
      chrome.alarms.clear(TIMER_ALARM);
      setGlobalBadge("↑", BADGE_AMBER);
    });
    return false;
  }

  if (message.type === "UPLOADING_SUCCESS") {
    completeSession(message).catch(console.error);
    return false;
  }

  if (message.type === "UPLOADING_ERROR") {
    failSession(message.error || "Chưa kết nối được My Hub", message).catch(console.error);
    return false;
  }

  return false;
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);
  const { baseUrl } = await getConfig();
  chrome.tabs.create({ url: `${baseUrl}/meetings` });
});

chrome.runtime.onStartup.addListener(async () => {
  if (await getPending()) setGlobalBadge("!", BADGE_RED);
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const meetingTabs = await chrome.tabs.query({
      url: [
        "https://meet.google.com/*",
        "https://*.zoom.us/*",
        "https://teams.microsoft.com/*",
        "https://teams.live.com/*",
      ],
    });
    for (const tab of meetingTabs) {
      if (!tab.id) continue;
      chrome.scripting
        .executeScript({ target: { tabId: tab.id }, files: ["content-meeting.js"] })
        .catch(() => undefined);
    }
  } catch {
    // ignore
  }
});
