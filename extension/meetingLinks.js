/**
 * Bộ nhận diện và chuẩn hoá link cuộc họp đa nền tảng:
 * - Google Meet (meet.google.com/abc-defg-hij, g.co/meet/...)
 * - Zoom (zoom.us/j/..., *.zoom.us/wc/..., zoom.us/my/...)
 * - Microsoft Teams (teams.microsoft.com/l/meetup-join/..., teams.live.com/meet/...)
 */

export const PLATFORM_META = {
  meet: {
    id: "meet",
    name: "Google Meet",
    shortName: "Meet",
    color: "#059669",
    bgColor: "#dcfce7",
    textColor: "#15803d",
  },
  zoom: {
    id: "zoom",
    name: "Zoom",
    shortName: "Zoom",
    color: "#2563eb",
    bgColor: "#dbeafe",
    textColor: "#1d4ed8",
  },
  teams: {
    id: "teams",
    name: "Microsoft Teams",
    shortName: "Teams",
    color: "#4f46e5",
    bgColor: "#e0e7ff",
    textColor: "#4338ca",
  },
};

export function normalizeMeetCode(raw) {
  if (!raw || typeof raw !== "string") return null;
  const clean = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (clean.length === 10) {
    return `${clean.slice(0, 3)}-${clean.slice(3, 7)}-${clean.slice(7)}`;
  }
  return null;
}

/**
 * Phân tích một URL hoặc chuỗi để xem có phải link phòng họp Meet / Zoom / Teams hay không.
 * Trả về:
 *   { platform: 'meet'|'zoom'|'teams', code: string, url: string, webJoinUrl?: string, label: string }
 * hoặc null nếu không phải link họp.
 */
export function parseMeetingLink(input) {
  if (!input || typeof input !== "string") return null;
  const raw = input.trim().replace(/[.,;:!?\])}]+$/, "");
  if (!raw) return null;

  // 1. GOOGLE MEET
  // Dạng URL: https://meet.google.com/abc-defg-hij hoặc meet.google.com/lookup/slug
  const meetUrlRe = /(?:https?:\/\/)?(?:meet\.google\.com\/(?:_meet\/|lookup\/)?|g\.co\/meet\/)([a-zA-Z0-9_-]+)/i;
  const meetMatch = meetUrlRe.exec(raw);
  if (meetMatch) {
    const candidate = meetMatch[1];
    // Mã trang chủ Meet không phải phòng họp
    if (/^(landing|new|about|pricing|download|support|terms|privacy)$/i.test(candidate)) {
      return null;
    }
    const hyphenRe = /^([a-zA-Z]{3})-([a-zA-Z]{4})-([a-zA-Z]{3})$/;
    const h = hyphenRe.exec(candidate);
    if (h) {
      const code = `${h[1]}-${h[2]}-${h[3]}`.toLowerCase();
      return {
        platform: "meet",
        code,
        url: `https://meet.google.com/${code}`,
        label: `Meet: ${code}`,
      };
    }
    const norm = /^[a-zA-Z]{10}$/.test(candidate) ? normalizeMeetCode(candidate) : null;
    if (norm) {
      return {
        platform: "meet",
        code: norm,
        url: `https://meet.google.com/${norm}`,
        label: `Meet: ${norm}`,
      };
    }
    if (candidate.length >= 3) {
      return {
        platform: "meet",
        code: candidate.toLowerCase(),
        url: `https://meet.google.com/lookup/${candidate}`,
        label: `Meet: ${candidate}`,
      };
    }
  }

  // 2. ZOOM
  // Dạng: https://us05web.zoom.us/j/12345678901?pwd=xxx hoặc zoom.us/wc/join/123456789 hoặc zoom.us/s/123456789 hoặc zoom.us/my/username
  const zoomUrlRe =
    /(?:https?:\/\/)?((?:[a-zA-Z0-9-]+\.)?zoom\.us)\/(?:j|s|w|wc\/(?:join|start)|my)\/([a-zA-Z0-9._-]+)(?:\?([^\s"'<>]*))?/i;
  const zoomMatch = zoomUrlRe.exec(raw);
  if (zoomMatch) {
    const host = zoomMatch[1].toLowerCase();
    const roomId = zoomMatch[2];
    const query = zoomMatch[3] ? `?${zoomMatch[3]}` : "";
    const isNumericId = /^\d{9,11}$/.test(roomId);
    const fullUrl = `https://${host}/${isNumericId ? "j" : "my"}/${roomId}${query}`;
    // Link mở trực tiếp bằng Zoom Web Client trên trình duyệt Chrome để ghi âm tabCapture được ngay
    const webJoinUrl = isNumericId ? `https://${host}/wc/join/${roomId}${query}` : fullUrl;
    return {
      platform: "zoom",
      code: roomId,
      url: fullUrl,
      webJoinUrl,
      label: `Zoom: ${roomId}`,
    };
  }

  // 3. MICROSOFT TEAMS
  // Dạng:
  // - https://teams.microsoft.com/l/meetup-join/...
  // - https://teams.live.com/meet/938472938472?...
  // - https://teams.microsoft.com/meet/...
  // - https://teams.microsoft.com/v2/?meetingjoin=true...
  const teamsUrlRe =
    /(?:https?:\/\/)?((?:[a-zA-Z0-9-]+\.)?teams\.(?:microsoft|live)\.com)\/(l\/meetup-join\/[^\s"'<>]+|meet\/[^\s"'<>]+|v2\/\?[^\s"'<>]*meetingjoin[^\s"'<>]*)/i;
  const teamsMatch = teamsUrlRe.exec(raw);
  if (teamsMatch) {
    const host = teamsMatch[1].toLowerCase();
    const pathAndQuery = teamsMatch[2].replace(/[.,;:!?\])}]+$/, "");
    const fullUrl = `https://${host}/${pathAndQuery}`;

    let code = "teams-room";
    const liveMeetId = /meet\/([a-zA-Z0-9_-]+)/i.exec(pathAndQuery);
    if (liveMeetId) {
      code = liveMeetId[1].slice(0, 14);
    } else {
      const threadMatch = /19(?:%3a|:)meeting_([a-zA-Z0-9_-]+)/i.exec(pathAndQuery);
      if (threadMatch) {
        code = threadMatch[1].slice(0, 10);
      }
    }

    return {
      platform: "teams",
      code,
      url: fullUrl,
      label: `Teams: ${code}`,
    };
  }

  return null;
}

/**
 * Quét toàn bộ văn bản và danh sách href để trích xuất tất cả các link cuộc họp (Meet, Zoom, Teams) duy nhất.
 */
export function extractAllMeetingLinks({ hrefs = [], text = "", pageTitle = "", pageUrl = "" } = {}) {
  const map = new Map();

  function addCandidate(raw, contextText = "") {
    const parsed = parseMeetingLink(raw);
    if (!parsed) return;
    const key = `${parsed.platform}:${parsed.code}`;
    if (!map.has(key)) {
      map.set(key, {
        ...parsed,
        key,
        contextTitle: cleanContextTitle(contextText, parsed) || cleanPageTitle(pageTitle),
        sourceUrl: pageUrl,
        detectedAt: Date.now(),
      });
    } else if (contextText && !map.get(key).contextTitle) {
      map.get(key).contextTitle = cleanContextTitle(contextText, parsed);
    }
  }

  for (const item of hrefs) {
    if (typeof item === "string") {
      addCandidate(item);
    } else if (item && typeof item.href === "string") {
      addCandidate(item.href, item.text || "");
    }
  }

  if (text) {
    // Quét URL hoặc pattern trong text
    const patterns = [
      /(?:https?:\/\/)?(?:meet\.google\.com\/(?:_meet\/|lookup\/)?|g\.co\/meet\/)[a-zA-Z0-9_-]+/gi,
      /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?zoom\.us\/(?:j|s|w|wc\/(?:join|start)|my)\/[a-zA-Z0-9._-]+(?:\?[^\s"'<>)]*)?/gi,
      /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/[^\s"'<>)]+/gi,
    ];
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        addCandidate(m[0]);
      }
    }
  }

  return Array.from(map.values());
}

function cleanContextTitle(text, parsed) {
  if (!text || typeof text !== "string") return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length < 3) return "";
  if (cleaned.includes("http://") || cleaned.includes("https://") || cleaned.includes(parsed.code)) {
    return "";
  }
  return cleaned.slice(0, 100);
}

function cleanPageTitle(title) {
  if (!title || typeof title !== "string") return "";
  return title.replace(/\s+/g, " ").trim().slice(0, 100);
}

/**
 * Kiểm tra xem một URL tab hiện tại có phải là phòng họp đang mở hay không.
 */
export function detectActiveMeetingFromTabUrl(url, title = "") {
  if (!url || typeof url !== "string") return null;

  // 1. Thử parse trực tiếp từ URL
  const direct = parseMeetingLink(url);
  if (direct) {
    return {
      ...direct,
      title: buildDefaultMeetingTitle(direct, title),
    };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  const host = parsedUrl.hostname.toLowerCase();

  // 2. Nếu đang ở trên meet.google.com và mã phòng nằm ở title
  if (host === "meet.google.com") {
    const titleCode = /\b([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})\b/.exec(title);
    if (titleCode) {
      const code = titleCode[1].toLowerCase();
      return {
        platform: "meet",
        code,
        url: `https://meet.google.com/${code}`,
        label: `Meet: ${code}`,
        title: `Họp Google Meet (${code})`,
      };
    }
  }

  // 3. Nếu đang ở trên Zoom Web Client (VD: *.zoom.us/wc/123456789/start hoặc /join)
  if (host.endsWith("zoom.us")) {
    const wcMatch = /\/wc\/(\d{9,11})\/(?:join|start)/i.exec(parsedUrl.pathname);
    if (wcMatch) {
      const code = wcMatch[1];
      return {
        platform: "zoom",
        code,
        url: `https://${host}/j/${code}${parsedUrl.search || ""}`,
        webJoinUrl: url,
        label: `Zoom: ${code}`,
        title: buildDefaultMeetingTitle({ platform: "zoom", code }, title),
      };
    }
  }

  // 4. Nếu đang ở trên Microsoft Teams Web App (teams.microsoft.com hoặc teams.live.com)
  if (host.endsWith("teams.microsoft.com") || host.endsWith("teams.live.com")) {
    const isCalling =
      parsedUrl.pathname.includes("meetup-join") ||
      parsedUrl.pathname.includes("/meet/") ||
      parsedUrl.search.includes("meetingjoin") ||
      parsedUrl.hash.includes("meetup-join") ||
      /meeting|cuộc họp|call/i.test(title);
    if (isCalling) {
      const codeMatch = /([a-zA-Z0-9]{6,14})/.exec(parsedUrl.pathname);
      const code = codeMatch ? codeMatch[1] : "teams-live";
      return {
        platform: "teams",
        code,
        url,
        label: `Teams: ${code}`,
        title: buildDefaultMeetingTitle({ platform: "teams", code }, title),
      };
    }
  }

  return null;
}

export function buildDefaultMeetingTitle(meetingInfo, rawTabTitle = "") {
  const pName = PLATFORM_META[meetingInfo.platform]?.name || "Cuộc họp";
  const cleanedTitle = (rawTabTitle || "")
    .replace(/^Meet\s*[-–—]\s*/i, "")
    .replace(/\s*[-|]\s*(Google Meet|Zoom|Microsoft Teams).*$/i, "")
    .trim();

  if (
    cleanedTitle &&
    cleanedTitle.length >= 3 &&
    cleanedTitle.toLowerCase() !== meetingInfo.code?.toLowerCase() &&
    !/^(google meet|zoom|microsoft teams)$/i.test(cleanedTitle)
  ) {
    return cleanedTitle.slice(0, 100);
  }
  return `Họp ${pName} (${meetingInfo.code})`;
}
