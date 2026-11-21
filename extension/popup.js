import { getConfig } from "./api.js";
import {
  parseMeetingLink,
  extractAllMeetingLinks,
  detectActiveMeetingFromTabUrl,
  PLATFORM_META,
} from "./meetingLinks.js";

const viewReady = document.getElementById("viewReady");
const viewRecording = document.getElementById("viewRecording");
const viewUploading = document.getElementById("viewUploading");
const viewSuccess = document.getElementById("viewSuccess");
const viewFailed = document.getElementById("viewFailed");

const btnOpenHub = document.getElementById("btnOpenHub");
const btnOptions = document.getElementById("btnOptions");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");

const roomBadge = document.getElementById("roomBadge");
const meetingTitleDisplay = document.getElementById("meetingTitleDisplay");
const meetingSubtext = document.getElementById("meetingSubtext");
const recordingMetaInputs = document.getElementById("recordingMetaInputs");
const customTitleInput = document.getElementById("customTitleInput");
const attendeesInput = document.getElementById("attendeesInput");

const btnRescanPage = document.getElementById("btnRescanPage");
const tabPageLinks = document.getElementById("tabPageLinks");
const tabHistoryLinks = document.getElementById("tabHistoryLinks");
const countPageLinks = document.getElementById("countPageLinks");
const countHistoryLinks = document.getElementById("countHistoryLinks");
const manualLinkInput = document.getElementById("manualLinkInput");
const btnAddManualLink = document.getElementById("btnAddManualLink");
const linksContainer = document.getElementById("linksContainer");
const historyFooter = document.getElementById("historyFooter");
const btnClearHistory = document.getElementById("btnClearHistory");

const timerDisplay = document.getElementById("timerDisplay");
const recMeetingName = document.getElementById("recMeetingName");

const uploadingReason = document.getElementById("uploadingReason");
const btnDownloadWhileUploading = document.getElementById("btnDownloadWhileUploading");

const successMeetingTitle = document.getElementById("successMeetingTitle");
const successMeetingSummary = document.getElementById("successMeetingSummary");
const btnOpenMeetingRecap = document.getElementById("btnOpenMeetingRecap");
const btnDownloadSuccess = document.getElementById("btnDownloadSuccess");
const btnBackToHome = document.getElementById("btnBackToHome");

const failedMeetingName = document.getElementById("failedMeetingName");
const failedReason = document.getElementById("failedReason");
const btnDownloadFailed = document.getElementById("btnDownloadFailed");
const btnRetry = document.getElementById("btnRetry");
const btnDiscard = document.getElementById("btnDiscard");

const SESSION_KEY = "current_recording_session";
const PENDING_KEY = "myhub_pending_upload";
const DONE_FRESH_MS = 30 * 60 * 1000;

const END_REASON_TEXT = {
  manual: "Bạn đã bấm dừng ghi âm.",
  "tab-closed": "Tab cuộc họp đã đóng.",
  "tab-capture-ended": "Tab cuộc họp đã đóng hoặc chuyển trang.",
  navigated: "Tab đã rời khỏi cuộc họp.",
  "left-meeting": "Bạn đã rời cuộc họp.",
  "max-duration": "Đã đạt thời lượng ghi tối đa.",
};

let currentTab = null;
let activeRoom = null;
let timerInterval = null;
let shownPhase = null;
let activeLinkTab = "page"; // 'page' | 'history'
let pageLinks = [];
let historyLinks = [];
let lastFileName = null;

function showView(view) {
  [viewReady, viewRecording, viewUploading, viewSuccess, viewFailed].forEach((v) => {
    v.classList.add("hidden");
  });
  if (view !== viewRecording) stopTimer();
  view.classList.remove("hidden");
}

function formatTimer(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function startTimer(startedAt) {
  if (timerInterval) clearInterval(timerInterval);
  const update = () => {
    const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    timerDisplay.innerText = formatTimer(elapsed);
  };
  update();
  timerInterval = setInterval(update, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

async function triggerDownloadCurrentRecording(customName) {
  const res = await chrome.runtime.sendMessage({ type: "REQUEST_DOWNLOAD_RECORDING" });
  if (!res?.ok || !res.url) {
    alert(res?.error || "Không tìm thấy bản ghi âm trong bộ nhớ đệm.");
    return;
  }
  const a = document.createElement("a");
  a.href = res.url;
  a.download = customName || lastFileName || `ghi-am-${Date.now()}.webm`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Quét phòng họp đang mở trên tab (hỗ trợ Meet, Zoom Web, Microsoft Teams)
 */
async function detectRoomInTab(tab) {
  if (!tab || !tab.id) return null;

  // 1. Hỏi content-meeting.js nếu đang ở trang họp
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "GET_MEETING_ROOM" });
    if (res?.room) return res.room;
  } catch {
    // ignore
  }

  // 2. Phân tích trực tiếp từ URL + Title của tab
  const byUrl = detectActiveMeetingFromTabUrl(tab.url || "", tab.title || "");
  if (byUrl) return byUrl;

  // 3. Nếu đang ở meet.google.com mà URL chưa hiện rõ, dùng scripting quét DOM
  if (tab.url && tab.url.includes("meet.google.com")) {
    try {
      const [execResult] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const textToScan = [
            window.location.href,
            document.title,
            document.querySelector("[data-meeting-title]")?.textContent,
            document.querySelector("[data-unresolved-meeting-id]")?.textContent,
            document.querySelector("[data-call-id]")?.getAttribute("data-call-id"),
            document.querySelector('[jsname="r4nke"]')?.textContent,
            document.body ? document.body.innerText.slice(0, 4000) : "",
          ]
            .filter(Boolean)
            .join(" ");
          const m = textToScan.match(/\b([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})\b/);
          return m ? m[1].toLowerCase() : null;
        },
      });
      if (execResult?.result) {
        const code = execResult.result;
        return {
          platform: "meet",
          code,
          url: `https://meet.google.com/${code}`,
          title: `Họp Google Meet (${code})`,
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Quét mọi link Meet / Zoom / Teams xuất hiện trên trang web hiện tại
 */
async function scanLinksInActiveTab(tab) {
  if (!tab || !tab.id || !tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    return [];
  }

  // 1. Thử gọi content-scanner.js trong tab
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_PAGE_NOW" });
    if (res?.ok && res.payload) {
      const links = extractAllMeetingLinks(res.payload);
      await chrome.runtime.sendMessage({
        type: "SAVE_DETECTED_LINKS",
        tabId: tab.id,
        links,
      });
      return links;
    }
  } catch {
    // Tab mở trước khi cài extension -> dùng chrome.scripting.executeScript để quét trực tiếp
  }

  try {
    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const anchors = Array.from(document.querySelectorAll("a[href]")).map((a) => ({
          href: a.getAttribute("href") || "",
          text: a.getAttribute("aria-label") || a.getAttribute("title") || a.textContent?.trim() || "",
        }));
        const bodyText = document.body ? document.body.innerText.slice(0, 25000) : "";
        return {
          hrefs: anchors,
          text: bodyText,
          pageTitle: document.title || "",
          pageUrl: window.location.href,
        };
      },
    });
    if (execResult?.result) {
      const links = extractAllMeetingLinks(execResult.result);
      await chrome.runtime.sendMessage({
        type: "SAVE_DETECTED_LINKS",
        tabId: tab.id,
        links,
      });
      return links;
    }
  } catch {
    // Không quét được trên trang đặc biệt (Chrome Web Store, v.v.)
  }

  return [];
}

function getBadgeClass(platform) {
  if (platform === "meet") return "badge badge-meet";
  if (platform === "zoom") return "badge badge-zoom";
  if (platform === "teams") return "badge badge-teams";
  return "badge badge-idle";
}

function renderLinksList() {
  countPageLinks.innerText = String(pageLinks.length);
  countHistoryLinks.innerText = String(historyLinks.length);

  const list = activeLinkTab === "page" ? pageLinks : historyLinks;
  historyFooter.classList.toggle("hidden", activeLinkTab !== "history" || historyLinks.length === 0);

  linksContainer.innerHTML = "";
  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-hint";
    empty.innerText =
      activeLinkTab === "page"
        ? "Chưa thấy link Google Meet, Zoom hay Teams nào trên trang này. Bạn có thể dán link hoặc mã phòng vào ô phía trên."
        : "Chưa có lịch sử link cuộc họp nào.";
    linksContainer.appendChild(empty);
    return;
  }

  for (const item of list) {
    const pMeta = PLATFORM_META[item.platform] || PLATFORM_META.meet;
    const card = document.createElement("div");
    card.className = "link-item";

    const top = document.createElement("div");
    top.className = "link-item-top";

    const badge = document.createElement("span");
    badge.className = getBadgeClass(item.platform);
    badge.innerText = `${pMeta.shortName} · ${item.code}`;

    const title = document.createElement("span");
    title.className = "link-title";
    title.innerText = item.contextTitle || `Phòng họp ${pMeta.name}`;

    top.appendChild(badge);
    top.appendChild(title);

    const urlLine = document.createElement("div");
    urlLine.className = "link-url";
    urlLine.innerText = item.url;

    const actions = document.createElement("div");
    actions.className = "link-actions";

    const btnCopy = document.createElement("button");
    btnCopy.className = "btn-mini";
    btnCopy.innerText = "📋 Copy link";
    btnCopy.onclick = async () => {
      await navigator.clipboard.writeText(item.url);
      btnCopy.innerText = "✅ Đã chép";
      setTimeout(() => {
        btnCopy.innerText = "📋 Copy link";
      }, 1500);
    };

    const btnOpen = document.createElement("button");
    btnOpen.className = "btn-mini btn-mini-primary";
    btnOpen.innerText = item.platform === "zoom" && item.webJoinUrl ? "🚀 Mở Zoom Web" : "🚀 Mở phòng họp";
    btnOpen.onclick = () => {
      const targetUrl = item.platform === "zoom" && item.webJoinUrl ? item.webJoinUrl : item.url;
      chrome.tabs.create({ url: targetUrl });
    };

    actions.appendChild(btnCopy);
    actions.appendChild(btnOpen);

    card.appendChild(top);
    card.appendChild(urlLine);
    card.appendChild(actions);
    linksContainer.appendChild(card);
  }
}

async function renderSessionState() {
  const [sessionData, pendingData] = await Promise.all([
    chrome.storage.session.get(SESSION_KEY),
    chrome.storage.local.get(PENDING_KEY),
  ]);
  const session = sessionData[SESSION_KEY];
  const pending = pendingData[PENDING_KEY];
  shownPhase = session?.phase ?? null;
  lastFileName = session?.fileName || pending?.fileName || null;

  if (session?.phase === "recording" && session.startedAt) {
    showView(viewRecording);
    recMeetingName.innerText = session.meeting?.title || "Cuộc họp đang ghi";
    startTimer(session.startedAt);
    return true;
  }

  if (session?.phase === "uploading") {
    uploadingReason.innerText = END_REASON_TEXT[session.endReason] || "";
    showView(viewUploading);
    return true;
  }

  if (session?.phase === "done" && Date.now() - (session.finishedAt || 0) < DONE_FRESH_MS) {
    showView(viewSuccess);
    successMeetingTitle.innerText = session.recapSummary?.title || session.meeting?.title || "Biên bản cuộc họp";
    const summaryText = session.recapSummary?.summary || "Biên bản đã được đồng bộ thẳng vào My Hub.";
    const actionCount = session.recapSummary?.actionCount || 0;
    successMeetingSummary.innerText =
      actionCount > 0 ? `${summaryText} (${actionCount} việc cần làm đã trích xuất)` : summaryText;
    return true;
  }

  if (session?.phase === "failed" || (!session && pending)) {
    failedMeetingName.innerText = session?.meeting?.title || pending?.meeting?.title || "Cuộc họp vừa ghi";
    failedReason.innerText =
      session?.error ||
      pending?.error ||
      "Bản ghi trước đó chưa được gửi sang My Hub (hoặc My Hub chưa bật).";
    showView(viewFailed);
    return true;
  }

  return false;
}

async function init() {
  const config = await getConfig();

  btnOptions.onclick = () => chrome.runtime.openOptionsPage();
  btnOpenHub.onclick = () => chrome.tabs.create({ url: `${config.baseUrl}/meetings` });

  if (await renderSessionState()) return;

  showView(viewReady);

  if (config.defaultAttendees && !attendeesInput.value) {
    attendeesInput.value = config.defaultAttendees;
  }

  // 1. Tìm tab đang xem
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) {
    const fallbackTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = fallbackTabs[0];
  }

  // 2. Quét link Meet / Zoom / Teams trên tab đang xem + lấy lịch sử
  const scannedOnActiveTab = await scanLinksInActiveTab(tab);
  const storedLinksRes = await chrome.runtime.sendMessage({
    type: "GET_DETECTED_LINKS",
    tabId: tab?.id,
  });
  pageLinks = scannedOnActiveTab.length > 0 ? scannedOnActiveTab : storedLinksRes?.tabLinks || [];
  historyLinks = storedLinksRes?.historyLinks || [];
  renderLinksList();

  // 3. Kiểm tra xem tab hiện tại (hoặc một tab khác đang mở) có phải phòng họp Meet / Zoom / Teams không
  let roomTab = tab;
  let room = await detectRoomInTab(tab);

  if (!room) {
    // Tìm xem có tab Meet / Zoom / Teams nào đang mở ở cửa sổ khác không
    const openMeetingTabs = await chrome.tabs.query({
      url: [
        "*://meet.google.com/*",
        "*://*.zoom.us/*",
        "*://teams.microsoft.com/*",
        "*://teams.live.com/*",
      ],
    });
    for (const candidateTab of openMeetingTabs) {
      const candidateRoom = await detectRoomInTab(candidateTab);
      if (candidateRoom) {
        roomTab = candidateTab;
        room = candidateRoom;
        break;
      }
    }
  }

  currentTab = roomTab;
  activeRoom = room;

  if (!room) {
    roomBadge.className = "badge badge-idle";
    roomBadge.innerText = "Chưa vào phòng họp";
    meetingTitleDisplay.innerText = "Mở phòng họp Google Meet, Zoom Web hoặc Teams để ghi âm";
    meetingSubtext.innerText =
      pageLinks.length > 0
        ? `Phát hiện ${pageLinks.length} link họp trên trang này — bấm "Mở phòng họp" bên dưới để tham gia!`
        : "Extension tự động bắt mọi link Meet, Zoom, Teams trên trang bạn đang xem.";
    recordingMetaInputs.classList.add("hidden");
    btnStart.disabled = true;
    btnStart.innerHTML = `<span>●</span> Bắt đầu ghi âm & Tạo biên bản AI`;
    return;
  }

  const pMeta = PLATFORM_META[room.platform] || PLATFORM_META.meet;
  roomBadge.className = getBadgeClass(room.platform);
  roomBadge.innerText = `${pMeta.name}: ${room.code}`;
  meetingTitleDisplay.innerText = room.title || `Họp ${pMeta.name} (${room.code})`;
  meetingSubtext.innerText = "Thu trọn âm thanh tab cuộc họp + micro của bạn và tự động tạo biên bản AI trên My Hub.";
  recordingMetaInputs.classList.remove("hidden");
  if (!customTitleInput.value) {
    customTitleInput.placeholder = `Tên cuộc họp (mặc định: ${room.title})`;
  }
  btnStart.disabled = false;
  btnStart.innerHTML = `<span>●</span> Ghi âm ${pMeta.shortName} & Tạo biên bản AI`;
}

// Chuyển tab hiển thị link
tabPageLinks.onclick = () => {
  activeLinkTab = "page";
  tabPageLinks.classList.add("active");
  tabHistoryLinks.classList.remove("active");
  renderLinksList();
};

tabHistoryLinks.onclick = () => {
  activeLinkTab = "history";
  tabHistoryLinks.classList.add("active");
  tabPageLinks.classList.remove("active");
  renderLinksList();
};

btnRescanPage.onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  pageLinks = await scanLinksInActiveTab(tab);
  const storedLinksRes = await chrome.runtime.sendMessage({
    type: "GET_DETECTED_LINKS",
    tabId: tab?.id,
  });
  historyLinks = storedLinksRes?.historyLinks || [];
  renderLinksList();
};

// Dán link hoặc mã phòng thủ công để bắt link
btnAddManualLink.onclick = async () => {
  const raw = manualLinkInput.value.trim();
  if (!raw) return;

  // Hỗ trợ cả khi người dùng chỉ dán mã Meet 10 ký tự hoặc abc-defg-hij
  let candidate = raw;
  if (/^[a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3}$/.test(raw) || /^[a-zA-Z]{10}$/.test(raw)) {
    candidate = `https://meet.google.com/${raw}`;
  } else if (/^\d{9,11}$/.test(raw.replace(/\s+/g, ""))) {
    candidate = `https://zoom.us/j/${raw.replace(/\s+/g, "")}`;
  }

  const parsed = parseMeetingLink(candidate);
  if (!parsed) {
    alert("Không nhận diện được link hoặc mã phòng Google Meet, Zoom hay Microsoft Teams.");
    return;
  }

  const linkEntry = {
    ...parsed,
    key: `${parsed.platform}:${parsed.code}`,
    contextTitle: `Link thêm thủ công (${PLATFORM_META[parsed.platform]?.shortName})`,
    detectedAt: Date.now(),
  };

  manualLinkInput.value = "";
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  pageLinks = [linkEntry, ...pageLinks.filter((l) => l.key !== linkEntry.key)];
  const res = await chrome.runtime.sendMessage({
    type: "SAVE_DETECTED_LINKS",
    tabId: tab?.id,
    links: pageLinks,
  });
  historyLinks = res?.historyLinks || historyLinks;
  renderLinksList();
};

manualLinkInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnAddManualLink.click();
});

btnClearHistory.onclick = async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_LINK_HISTORY" });
  historyLinks = [];
  renderLinksList();
};

// Bắt đầu ghi âm 1-click
btnStart.onclick = async () => {
  if (!currentTab?.id || !activeRoom) return;
  btnStart.disabled = true;
  btnStart.innerHTML = `<span class="spinner"></span> Đang kết nối âm thanh tab + micro...`;

  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: currentTab.id });
    const finalTitle = customTitleInput.value.trim() || activeRoom.title;
    const finalAttendees = attendeesInput.value.trim();

    const meetingPayload = {
      ...activeRoom,
      title: finalTitle,
      attendees: finalAttendees,
    };

    const res = await chrome.runtime.sendMessage({
      type: "START_SESSION",
      payload: {
        tabId: currentTab.id,
        streamId,
        meeting: meetingPayload,
      },
    });
    if (!res?.ok) throw new Error(res?.error || "Không thể khởi động ghi âm");

    showView(viewRecording);
    recMeetingName.innerText = meetingPayload.title;
    startTimer(res.session.startedAt);
    shownPhase = "recording";
  } catch (err) {
    alert(`Lỗi: ${err.message}`);
    btnStart.disabled = false;
    btnStart.innerHTML = `<span>●</span> Bắt đầu ghi âm & Tạo biên bản AI`;
  }
};

// Dừng ghi âm
btnStop.onclick = async () => {
  showView(viewUploading);
  shownPhase = "uploading";

  const res = await chrome.runtime.sendMessage({ type: "STOP_SESSION" });
  if (!res?.ok) {
    alert(`Lỗi khi dừng: ${res?.error || "Không rõ lỗi"}`);
    init();
  }
};

btnDownloadWhileUploading.onclick = () => void triggerDownloadCurrentRecording();
btnDownloadSuccess.onclick = () => void triggerDownloadCurrentRecording();
btnDownloadFailed.onclick = () => void triggerDownloadCurrentRecording();

btnOpenMeetingRecap.onclick = async () => {
  const { baseUrl } = await getConfig();
  chrome.tabs.create({ url: `${baseUrl}/meetings` });
};

btnBackToHome.onclick = async () => {
  await chrome.storage.session.remove(SESSION_KEY);
  shownPhase = null;
  init();
};

btnRetry.onclick = async () => {
  btnRetry.disabled = true;
  const res = await chrome.runtime.sendMessage({ type: "RETRY_UPLOAD" });
  btnRetry.disabled = false;
  if (!res?.ok) alert(`Chưa gửi lại được: ${res?.error || "Không rõ lỗi"}`);
};

btnDiscard.onclick = async () => {
  if (!confirm("Xoá bản ghi âm tạm này khỏi bộ nhớ trình duyệt?")) return;
  await chrome.runtime.sendMessage({ type: "DISCARD_PENDING" });
  init();
};

chrome.storage.onChanged.addListener((changes, area) => {
  const change = area === "session" ? changes[SESSION_KEY] : area === "local" ? changes[PENDING_KEY] : null;
  if (!change) return;
  const nextPhase = change.newValue?.phase ?? null;
  if (area === "session") {
    if (nextPhase === shownPhase) return;
    if (nextPhase === null && shownPhase === "done") return;
  }
  init();
});

init();
