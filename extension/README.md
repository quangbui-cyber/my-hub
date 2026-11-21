# My Hub Recorder - Chrome Extension (Meet · Zoom · Teams)

Extension Chrome giúp **tự động bắt link phòng họp Google Meet, Zoom, Microsoft Teams** trên mọi trang web và **1-click ghi âm cuộc họp + tạo biên bản AI** đồng bộ trực tiếp với **My Hub** (được xây dựng theo kiến trúc chuẩn của `quangbui-cyber/taskflow`).

---

## Tính năng nổi bật

1. **Tự động bắt link đa nền tảng (`Meet` · `Zoom` · `Teams`)**:
   - Tự động quét mọi trang web bạn đang xem (Gmail, Google Calendar, Slack, Zalo Web, Messenger, Notion, Jira...) để gom tất cả link **Google Meet** (`meet.google.com/abc-defg-hij`), **Zoom** (`zoom.us/j/...`, `*.zoom.us/wc/...`) và **Microsoft Teams** (`teams.microsoft.com/l/meetup-join/...`, `teams.live.com/meet/...`).
   - Hiển thị số lượng link bắt được ngay trên badge của icon Extension và lưu vào lịch sử **Đã bắt gần đây**.
   - Hỗ trợ nút **Copy link**, **Mở phòng họp / Mở Zoom Web** và ô dán nhanh mã phòng bất kỳ.

2. **1-Click Ghi âm cuộc họp (Tab Audio + Micro)**:
   - Dùng `chrome.tabCapture` kết hợp **Offscreen Audio Mixer** (`offscreen.js`) để thu trực tiếp cả tiếng của mọi người trong tab họp (Meet, Zoom Web, Teams Web) lẫn giọng nói từ Micro của bạn mà không cần hộp thoại chọn màn hình rườm rà.
   - **Loopback âm thanh**: Giữ nguyên âm thanh cuộc họp phát ra loa/tai nghe bình thường.
   - **Lọc ồn & chống vọng âm**: Tự động bật `echoCancellation`, `noiseSuppression`, `autoGainControl`.
   - **Lưu đệm an toàn 5 giây/lần**: Cắt từng đoạn 5 giây lưu vào IndexedDB (`myhub_recorder_db`) — lỡ mất mạng hay đóng tab đột ngột thì bản ghi vẫn còn nguyên.

3. **Tự động phát hiện rời họp & kết thúc ghi âm**:
   - Tích hợp `meet-hook.js` theo dõi trực tiếp số kết nối `RTCPeerConnection` còn mở cùng với tín hiệu bấm nút Rời cuộc gọi / màn hình kết thúc cuộc họp trên cả **Google Meet, Zoom Web và Microsoft Teams**.
   - Khi bạn rời cuộc họp, host kết thúc cuộc họp hoặc đóng tab, Extension tự động dừng ghi âm, gửi file sang My Hub và thông báo khi biên bản AI hoàn tất.

4. **Tự động tạo Biên bản AI & Đồng bộ thẳng vào My Hub**:
   - Đẩy file âm thanh `.webm` sang `POST /api/recap` của `my-hub` (Groq Whisper chép lời tiếng Việt + Gemini tổng hợp biên bản theo chủ đề, quyết định & việc cần làm, có kèm **Từ điển AI** của bạn).
   - Tự động lưu biên bản vừa tạo thẳng vào trang `/meetings` của `my-hub`.
   - Luôn có nút **⬇️ Tải file ghi âm (.webm) về máy** ngay trong Popup ở mọi trạng thái.

---

## Hướng dẫn cài đặt lên Chrome (1 phút)

1. Mở trình duyệt Google Chrome, nhập vào thanh địa chỉ:
   ```
   chrome://extensions
   ```
2. Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
3. Bấm nút **Tải tiện ích đã giải nén (Load unpacked)** ở góc trên bên trái.
4. Chọn thư mục:
   ```
   /Users/duyquang/Desktop/Project Personal/my-hub/extension
   ```
5. Bấm biểu tượng mảnh ghép 🧩 trên thanh công cụ Chrome → Ghim (**Pin**) **My Hub Recorder** ra ngoài.
6. Bấm chuột phải vào icon Extension → **Tùy chọn (Options)** (hoặc bấm biểu tượng ⚙️ trong Popup) → Bấm **Cấp quyền Micro** để cho phép thu cả giọng nói của bạn.

---

## Cách sử dụng

- **Bắt link họp**: Mở bất kỳ trang nào có link Meet / Zoom / Teams (hoặc dán link/mã phòng vào ô trong Popup) → Bấm **Copy link** hoặc **Mở phòng họp**. Với Zoom, nút **🚀 Mở Zoom Web** sẽ mở trực tiếp bằng Zoom Web Client trên Chrome để bạn có thể ghi âm tab 1-click.
- **Ghi âm & Tạo biên bản AI**:
  1. Đảm bảo ứng dụng `my-hub` đang chạy (`npm run dev` tại `http://localhost:3000`).
  2. Khi đang ở trong tab phòng họp **Google Meet**, **Zoom Web**, hoặc **Microsoft Teams Web**, mở Popup Extension (hoặc nhấn phím tắt **`Alt + Shift + R`**).
  3. Bấm **Bắt đầu ghi âm & Tạo biên bản AI**.
  4. Khi họp xong, chỉ cần rời phòng họp, đóng tab hoặc bấm **Dừng ghi & Tạo biên bản AI** — Extension sẽ tự động chép lời, tạo biên bản và lưu thẳng vào mục **Meeting** trên My Hub!
