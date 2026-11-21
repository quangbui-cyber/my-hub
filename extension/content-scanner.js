/**
 * My Hub Recorder - Content Script tự động quét và bắt link Google Meet, Zoom, Microsoft Teams
 * trên bất kỳ trang web nào bạn đang mở (Gmail, Google Calendar, Slack, Messenger, Zalo Web, Notion, Jira...).
 */
(() => {
  if (window.__myhubScannerLoaded) return;
  window.__myhubScannerLoaded = true;

  function extensionAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  const LINK_SELECTORS = [
    'a[href*="meet.google.com"]',
    'a[href*="g.co/meet"]',
    'a[href*="zoom.us/j/"]',
    'a[href*="zoom.us/s/"]',
    'a[href*="zoom.us/w/"]',
    'a[href*="zoom.us/wc/"]',
    'a[href*="zoom.us/my/"]',
    'a[href*="teams.microsoft.com/l/meetup-join"]',
    'a[href*="teams.microsoft.com/meet"]',
    'a[href*="teams.live.com/meet"]',
    "[data-meet-url]",
    "[data-conference-url]",
  ].join(",");

  let lastSentHash = "";
  let scanTimeout = null;

  function collectLinksFromDom() {
    const hrefs = [];
    const seen = new Set();

    try {
      const elements = document.querySelectorAll(LINK_SELECTORS);
      for (const el of elements) {
        const rawHref =
          el.getAttribute("href") ||
          el.getAttribute("data-meet-url") ||
          el.getAttribute("data-conference-url") ||
          "";
        if (!rawHref) continue;

        // Xử lý link redirect của Google (VD: https://www.google.com/url?q=https://meet.google.com/...)
        let cleanHref = rawHref;
        try {
          const u = new URL(rawHref, window.location.origin);
          if (
            (u.hostname.includes("google.") || u.hostname.includes("facebook.") || u.hostname.includes("nam")) &&
            (u.searchParams.get("q") || u.searchParams.get("url") || u.searchParams.get("u"))
          ) {
            cleanHref = u.searchParams.get("q") || u.searchParams.get("url") || u.searchParams.get("u") || rawHref;
          }
        } catch {
          // giữ nguyên
        }

        if (seen.has(cleanHref)) continue;
        seen.add(cleanHref);

        // Tìm ngữ cảnh tên cuộc họp gần thẻ <a> nhất
        const container = el.closest("tr, li, article, [role='listitem'], [role='row'], [data-eventchip], div");
        const contextText =
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          el.textContent?.trim() ||
          container?.querySelector("h1, h2, h3, h4, strong, [role='heading']")?.textContent?.trim() ||
          "";

        hrefs.push({ href: cleanHref, text: contextText });
      }
    } catch {
      // ignore DOM errors
    }

    // Quét thêm văn bản thuần trên trang (giới hạn 25.000 ký tự đầu để siêu nhẹ)
    const bodyText = document.body ? document.body.innerText.slice(0, 25000) : "";

    return {
      hrefs,
      text: bodyText,
      pageTitle: document.title || "",
      pageUrl: window.location.href,
    };
  }

  function runScan(force = false) {
    if (!extensionAlive()) return;
    const payload = collectLinksFromDom();
    const quickHash = `${payload.hrefs.map((h) => h.href).join("|")}::${payload.text.length}`;
    if (!force && quickHash === lastSentHash) return;
    lastSentHash = quickHash;

    try {
      chrome.runtime
        .sendMessage({
          type: "PAGE_LINKS_SCANNED",
          payload,
        })
        .catch(() => undefined);
    } catch {
      // ignore
    }
  }

  function scheduleScan() {
    if (scanTimeout) return;
    scanTimeout = setTimeout(() => {
      scanTimeout = null;
      runScan(false);
    }, 1200);
  }

  // Quét ngay khi trang vừa tải xong
  runScan(true);

  // Theo dõi thay đổi DOM (khi mở email mới trong Gmail, cuộn chat Slack/Zalo/Messenger, bấm vào sự kiện Lịch)
  const observer = new MutationObserver(() => {
    scheduleScan();
  });
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // Cho phép Popup chủ động yêu cầu quét tức thì
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SCAN_PAGE_NOW") {
      const payload = collectLinksFromDom();
      sendResponse({ ok: true, payload });
      return false;
    }
  });
})();
