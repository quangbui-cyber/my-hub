/**
 * My Hub Recorder - API Client kết nối với My Hub (mặc định: http://localhost:3000)
 */

export const DEFAULT_BASE_URL = "http://localhost:3000";

export async function getConfig() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const data = await chrome.storage.local.get([
      "myhub_base_url",
      "myhub_user_name",
      "myhub_default_attendees",
      "myhub_send_chat_notice",
    ]);
    return {
      baseUrl: (data.myhub_base_url || DEFAULT_BASE_URL).replace(/\/+$/, ""),
      userName: data.myhub_user_name || "",
      defaultAttendees: data.myhub_default_attendees || "",
      sendChatNotice: data.myhub_send_chat_notice !== false,
    };
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_CONFIG" }, (res) => {
        resolve({
          baseUrl: (res?.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
          userName: res?.userName || "",
          defaultAttendees: res?.defaultAttendees || "",
          sendChatNotice: res?.sendChatNotice !== false,
        });
      });
    });
  }

  return {
    baseUrl: DEFAULT_BASE_URL,
    userName: "",
    defaultAttendees: "",
    sendChatNotice: true,
  };
}

export async function setConfig({ baseUrl, userName, defaultAttendees, sendChatNotice }) {
  const payload = {};
  if (baseUrl !== undefined) payload.myhub_base_url = baseUrl.trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
  if (userName !== undefined) payload.myhub_user_name = userName.trim();
  if (defaultAttendees !== undefined) payload.myhub_default_attendees = defaultAttendees.trim();
  if (sendChatNotice !== undefined) payload.myhub_send_chat_notice = Boolean(sendChatNotice);
  await chrome.storage.local.set(payload);
}

/**
 * Gửi file ghi âm (.webm) sang POST /api/recap của My Hub để Groq Whisper chép lời & Gemini viết biên bản.
 */
export async function uploadAudioToMyHubRecap({
  fileBlob,
  fileName,
  title,
  attendees = "",
  glossary = { terms: [], rules: [] },
  baseUrl: explicitBaseUrl,
}) {
  const config = await getConfig();
  const baseUrl = (explicitBaseUrl || config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const safeName = fileName || `ghi-am-${Date.now()}.webm`;

  const form = new FormData();
  const file = new File([fileBlob], safeName, { type: "audio/webm" });
  form.append("file", file, safeName);
  if (title) form.append("title", title);
  const finalAttendees = attendees || config.defaultAttendees || "";
  if (finalAttendees) form.append("attendees", finalAttendees);
  if (glossary && (glossary.terms?.length || glossary.rules?.length)) {
    form.append("glossary", JSON.stringify(glossary));
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/api/recap`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    throw Object.assign(
      new Error(
        `Không kết nối được My Hub tại ${baseUrl}. Hãy đảm bảo bạn đang chạy "npm run dev" trong thư mục my-hub (hoặc bấm Tải file ghi âm về máy).`
      ),
      { status: 0, cause: err }
    );
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const msg = data?.error || `My Hub trả lỗi (${response.status})`;
    throw Object.assign(new Error(msg), { status: response.status });
  }

  return data;
}
