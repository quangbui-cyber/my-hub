/**
 * My Hub Recorder - Offscreen Audio Mixer & Recorder (theo cơ chế TaskFlow)
 *
 * Cơ chế:
 * 1. Nhận streamId từ `chrome.tabCapture.getMediaStreamId` để thu âm thanh tab họp (Meet / Zoom / Teams).
 * 2. Loopback âm thanh tab ra loa (`tabSource.connect(audioContext.destination)`) để người dùng vẫn nghe bình thường.
 * 3. Thu âm thanh micro với `echoCancellation`, `noiseSuppression`, `autoGainControl`.
 * 4. Trộn cả hai nguồn vào `MediaStreamAudioDestinationNode` và ghi bằng `MediaRecorder` (Opus 48kbps).
 * 5. Cắt chunk mỗi 5 giây lưu thẳng vào IndexedDB (`myhub_recorder_db`) để chống mất dữ liệu và cho phép
 *    tải file `.webm` về máy hoặc bấm "Thử gửi lại" bất cứ lúc nào.
 */

import { uploadAudioToMyHubRecap } from "./api.js";

const CHUNK_MS = 5000;
const UPLOAD_RETRY_DELAYS_MS = [0, 4000, 10000];

let mediaRecorder = null;
let audioContext = null;
let tabAudioStream = null;
let micAudioStream = null;
let recordingStartTime = 0;
let currentMeeting = null;
let currentFileName = null;
let currentBaseUrl = null;
let currentGlossary = null;
let currentChunks = [];
let stopPromise = null;

// IndexedDB giữ các chunk của phiên ghi hiện tại / gần nhất
let dbPromise = null;
function openDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("myhub_recorder_db", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("chunks")) {
          db.createObjectStore("chunks", { autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function saveChunkToDb(blob) {
  try {
    const db = await openDatabase();
    const tx = db.transaction("chunks", "readwrite");
    tx.objectStore("chunks").add({ blob, timestamp: Date.now() });
    await txDone(tx);
  } catch (err) {
    console.warn("Lưu chunk vào IndexedDB lỗi:", err);
  }
}

async function clearDbChunks() {
  try {
    const db = await openDatabase();
    const tx = db.transaction("chunks", "readwrite");
    tx.objectStore("chunks").clear();
    await txDone(tx);
  } catch {
    // ignore
  }
}

async function readDbChunks() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("chunks", "readonly").objectStore("chunks").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function notify(message) {
  try {
    chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // ignore
  }
}

function releaseAudio() {
  for (const stream of [tabAudioStream, micAudioStream]) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }
  tabAudioStream = null;
  micAudioStream = null;
  if (audioContext) {
    audioContext.close().catch(() => undefined);
    audioContext = null;
  }
}

async function startRecording({ streamId, meeting, fileName, baseUrl, glossary }) {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    throw new Error("Đang có phiên ghi âm khác đang chạy.");
  }

  currentMeeting = meeting || { id: `m_${Date.now()}`, title: "Cuộc họp online" };
  currentFileName = fileName || `ghi-am-${currentMeeting.platform || "meet"}-${Date.now()}.webm`;
  currentBaseUrl = baseUrl || null;
  currentGlossary = glossary || { terms: [], rules: [] };
  currentChunks = [];
  stopPromise = null;
  await clearDbChunks();

  // 1. Thu âm thanh tab từ streamId (1-click không cần hộp thoại getDisplayMedia)
  tabAudioStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  // 2. Thu âm thanh micro của người dùng (lọc ồn & chống vọng âm)
  try {
    micAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (micErr) {
    console.warn("Không mở được micro, tiếp tục chỉ với âm thanh tab:", micErr);
    micAudioStream = null;
  }

  // 3. Trộn âm thanh tab + mic bằng Web Audio API
  audioContext = new AudioContext();
  const tabSource = audioContext.createMediaStreamSource(tabAudioStream);

  // QUAN TRỌNG: Loopback âm thanh tab ra loa máy tính để người dùng vẫn nghe được cuộc họp bình thường!
  tabSource.connect(audioContext.destination);

  const mixerDestination = audioContext.createMediaStreamDestination();
  tabSource.connect(mixerDestination);

  if (micAudioStream) {
    const micSource = audioContext.createMediaStreamSource(micAudioStream);
    micSource.connect(mixerDestination);
  }

  // 4. Khởi chạy MediaRecorder định dạng Opus 48 kbps
  mediaRecorder = new MediaRecorder(mixerDestination.stream, {
    mimeType: "audio/webm;codecs=opus",
    audioBitsPerSecond: 48000,
  });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      currentChunks.push(event.data);
      void saveChunkToDb(event.data);
    }
  };

  // Khi tab họp đóng hoặc chuyển trang, track âm thanh kết thúc -> tự dừng & tạo biên bản
  tabAudioStream.getAudioTracks().forEach((track) => {
    track.addEventListener("ended", () => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        void stopRecording("tab-capture-ended");
      }
    });
  });

  recordingStartTime = Date.now();
  mediaRecorder.start(CHUNK_MS);

  notify({
    type: "RECORDING_STARTED",
    meeting: currentMeeting,
    startedAt: recordingStartTime,
    hasMic: Boolean(micAudioStream),
  });
}

function stopRecording(reason = "manual") {
  if (stopPromise) return stopPromise;
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    return Promise.resolve({ ok: false, error: "Không có phiên ghi nào đang chạy." });
  }

  const recorder = mediaRecorder;
  const durationSeconds = Math.max(1, Math.round((Date.now() - recordingStartTime) / 1000));
  const meeting = currentMeeting;
  const fileName = currentFileName;

  stopPromise = new Promise((resolve) => {
    recorder.onstop = () => {
      releaseAudio();
      mediaRecorder = null;

      const fullBlob = new Blob(currentChunks, { type: "audio/webm;codecs=opus" });
      currentChunks = [];

      resolve({ ok: true, durationSeconds, size: fullBlob.size, fileName });
      notify({
        type: "RECORDING_STOPPED",
        reason,
        meeting,
        durationSeconds,
        size: fullBlob.size,
        fileName,
      });

      void uploadWithRetry({
        meeting,
        fileBlob: fullBlob,
        fileName,
        durationSeconds,
        baseUrl: currentBaseUrl,
        glossary: currentGlossary,
      });
    };
    recorder.stop();
  });

  return stopPromise;
}

function shouldRetry(err) {
  return !err?.status || err.status >= 500;
}

async function uploadWithRetry(params) {
  notify({ type: "UPLOADING_START", meeting: params.meeting });
  let lastError = null;

  for (const delay of UPLOAD_RETRY_DELAYS_MS) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      const recapData = await uploadAudioToMyHubRecap({
        fileBlob: params.fileBlob,
        fileName: params.fileName,
        title: params.meeting?.title || "",
        attendees: params.meeting?.attendees || "",
        glossary: params.glossary,
        baseUrl: params.baseUrl,
      });
      // Lưu ý: Vẫn giữ bản ghi trong IndexedDB cho đến khi phiên mới bắt đầu để người dùng có thể bấm "Tải file ghi âm (.webm)" trong Popup!
      notify({
        type: "UPLOADING_SUCCESS",
        meeting: params.meeting,
        fileName: params.fileName,
        durationSeconds: params.durationSeconds,
        size: params.fileBlob.size,
        recap: recapData,
      });
      stopPromise = null;
      return;
    } catch (err) {
      lastError = err;
      console.error("Lỗi khi gửi bản ghi âm sang My Hub:", err);
      if (!shouldRetry(err)) break;
    }
  }

  notify({
    type: "UPLOADING_ERROR",
    meeting: params.meeting,
    fileName: params.fileName,
    durationSeconds: params.durationSeconds,
    size: params.fileBlob.size,
    error: lastError?.message || "Chưa tạo được biên bản trên My Hub",
  });
  stopPromise = null;
}

async function retryUpload({ meeting, fileName, startedAt, baseUrl, glossary }) {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    throw new Error("Đang có phiên ghi âm khác đang chạy.");
  }

  const rows = await readDbChunks();
  if (rows.length === 0) throw new Error("Không còn dữ liệu ghi âm trong bộ nhớ đệm để gửi lại.");

  const fileBlob = new Blob(
    rows.map((r) => r.blob),
    { type: "audio/webm;codecs=opus" }
  );
  const lastTimestamp = rows[rows.length - 1].timestamp || Date.now();
  const durationSeconds = Math.max(1, Math.round((lastTimestamp - (startedAt || lastTimestamp)) / 1000));

  void uploadWithRetry({
    meeting,
    fileBlob,
    fileName: fileName || `ghi-am-${Date.now()}.webm`,
    durationSeconds,
    baseUrl,
    glossary,
  });
}

/**
 * Tạo Object URL từ các chunk trong IndexedDB để người dùng tải trực tiếp file .webm về máy tính
 */
async function createDownloadBlobUrl() {
  const rows = await readDbChunks();
  if (rows.length === 0) {
    throw new Error("Không tìm thấy dữ liệu bản ghi âm trong bộ nhớ đệm.");
  }
  const fileBlob = new Blob(
    rows.map((r) => r.blob),
    { type: "audio/webm;codecs=opus" }
  );
  const url = URL.createObjectURL(fileBlob);
  // Thu hồi URL sau 2 phút
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  return { url, size: fileBlob.size };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return;

  if (message.type === "START") {
    startRecording(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        releaseAudio();
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (message.type === "STOP") {
    stopRecording(message.payload?.reason || "manual")
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "RETRY_UPLOAD") {
    retryUpload(message.payload || {})
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "GET_DOWNLOAD_URL") {
    createDownloadBlobUrl()
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "CLEAR_CHUNKS") {
    clearDbChunks()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});
