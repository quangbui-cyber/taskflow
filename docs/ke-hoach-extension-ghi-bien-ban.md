# Kế hoạch: Chrome Extension "1 click ghi biên bản" cho cuộc họp online

> Trạng thái: **kế hoạch, chưa code.** Chờ chốt các câu hỏi ở mục 13.
>
> Tóm tắt: người dùng đang ở tab Google Meet (hoặc Zoom/Teams bản web), bấm icon extension
> hoặc phím tắt một lần. Extension tự nhận ra cuộc họp trong lịch myCreative, thu âm thanh
> tab + micro không cần bảng chọn tab, và khi kết thúc thì đẩy vào **đúng luồng biên bản đang có**
> (Groq chép lời → Gemini viết biên bản nháp → người ghi biên bản duyệt → xuất bản).

---

## 1. Mục tiêu và phạm vi

**Mục tiêu**

1. **Bắt link tự động:** đang ở tab họp là extension biết đó là cuộc họp nào trong lịch app.
2. **1 click:** không còn bảng "Chọn tab / Chia sẻ âm thanh tab" như cách ghi trong app hiện nay.
3. **Dùng lại luồng biên bản sẵn có**, không viết lại phần chép lời, tóm tắt, việc cần làm.
4. **Minh bạch:** mọi người trong phòng biết cuộc họp đang được ghi biên bản (mục 7).

**Trong phạm vi**

- Extension cho Chrome và Edge máy tính (Manifest V3).
- Google Meet là ưu tiên số 1. Zoom web và Teams web dùng được ở chế độ "chọn cuộc họp thủ công".
- Phần app: token cho extension, API tìm cuộc họp theo link, nhận file ghi âm, lưu mã phòng Meet.

**Ngoài phạm vi (làm sau nếu cần)**

- Bot tự vào phòng họp (Recall.ai…).
- Lấy transcript có sẵn của Google Meet qua Meet REST API (cần Google Workspace trả phí).
- Google Meet Add-on (khung myCreative trong Meet).
- Ứng dụng Zoom/Teams bản cài trên máy (extension chỉ thấy được tab trình duyệt).

---

## 2. Vì sao chọn Chrome Extension

| Tiêu chí | Ghi trong app (hiện nay) | **Chrome Extension** | Meet REST API | Bot vào họp |
|---|---|---|---|---|
| Thao tác | Mở app, chọn tab, tick "chia sẻ âm thanh" | **1 click / phím tắt** | Tự động | Tự động |
| Hay quên tick âm thanh tab | Có | **Không** | Không | Không |
| Cần Google Workspace trả phí | Không | **Không** | Có | Không |
| Tiếng Việt | Groq — tốt | **Groq — tốt** | Chưa chắc hỗ trợ | Tuỳ dịch vụ |
| Zoom/Teams web | Có | **Có** | Không | Có |
| Chi phí thêm | 0 | **5 USD một lần** | 0 | 10–30 USD/người/tháng |
| Chạy trên điện thoại | Không | Không | Có | Có |

Kết luận: extension giải quyết đúng điểm đau hiện tại (thao tác rườm rà, quên chia sẻ âm thanh)
mà không phụ thuộc gói Google và tận dụng toàn bộ phần biên bản đã có.

---

## 3. Luồng người dùng

### 3.1 Cài đặt (một lần)

1. Cài extension **myCreative Recorder** từ Chrome Web Store (link không công khai),
   hoặc admin Google Workspace cài sẵn cho mọi máy.
2. Bấm icon → **Kết nối với myCreative** → mở trang `/profile/extension` trong app (đã đăng nhập)
   → bấm **Cho phép** → extension nhận token. Không phải nhập mật khẩu vào extension.
3. Extension mở trang cài đặt của nó một lần để **xin quyền micro** (Chrome bắt buộc xin quyền
   micro từ một trang hiển thị, không xin được ngầm).

### 3.2 Mỗi cuộc họp

1. Người dùng mở Google Meet như bình thường (từ lịch app, Google Calendar hay link bất kỳ).
2. Icon extension **đổi màu** khi phát hiện tab họp. Nếu cuộc họp có trong lịch app thì
   popup ghi sẵn tên cuộc họp.
3. Bấm icon (hoặc `Alt+Shift+R`) → bắt đầu ghi ngay:
   - Có đúng một cuộc họp khớp → ghi luôn.
   - Không khớp → popup hiện danh sách cuộc họp hôm nay của người đó để chọn, hoặc
     **Tạo cuộc họp nhanh** (tên + giờ hiện tại).
4. Trong lúc ghi: badge trên icon hiện thời gian (`12:05`). Tab Meet vẫn nghe bình thường.
   Extension gửi một dòng thông báo vào khung chat Meet (mục 7).
5. Kết thúc bằng một trong các cách: bấm icon → **Dừng**, rời cuộc họp, đóng tab, hoặc chạm
   giới hạn 225 phút.
6. Extension tải file lên và báo: "Đã gửi bản ghi. Biên bản sẽ sẵn sàng sau vài phút."
   Người ghi biên bản nhận thông báo như hiện nay khi bản nháp xong.

---

## 4. Kiến trúc tổng thể

```
┌──────────────── Chrome ────────────────┐            ┌──────── myCreative (Vercel) ────────┐
│ Tab Google Meet                         │            │                                      │
│   └ content script: đọc mã phòng,      │            │ /api/ext/meetings/lookup             │
│     gửi tin nhắn thông báo vào chat     │            │ /api/ext/meetings/[id]/recap/*       │
│                                         │  Bearer    │        │                             │
│ Service worker (nền)                    │  token     │        ▼                             │
│   └ nhận click/phím tắt, lấy streamId   │──────────▶ │ luồng biên bản có sẵn:               │
│                                         │            │  check → Blob upload → POST recap    │
│ Offscreen document                      │            │  → Groq chép lời → Gemini viết       │
│   └ tab audio + mic → MediaRecorder     │            │  → bản nháp → người ghi duyệt        │
│   └ lưu đoạn 5 giây vào IndexedDB       │            │                                      │
│                                         │            │ Vercel Blob (file tạm, xoá sau xử lý)│
│ Popup: trạng thái, chọn cuộc họp, dừng  │            └──────────────────────────────────────┘
└─────────────────────────────────────────┘
```

Nguyên tắc: **extension chỉ thay khâu thu âm.** Mọi kiểm tra quyền, hạn mức, độ dài, chép lời,
viết biên bản vẫn nằm ở server như hiện nay, nên không có hai bản logic phải giữ đồng bộ.

---

## 5. Thay đổi phía app (myCreative)

### 5.1 Cơ sở dữ liệu (1 migration)

```prisma
model Meeting {
  // …các trường hiện có…
  meetCode String? // "abc-defg-hij", tách từ meetingUrl; dùng để extension tìm cuộc họp
  @@index([meetCode])
}

model ExtensionToken {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique // sha256 của token; token gốc chỉ trả cho extension một lần
  label      String    // "Chrome trên MacBook của An"
  lastUsedAt DateTime?
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())
  @@index([userId])
}
```

- Migration điền sẵn `meetCode` cho các cuộc họp đã có `meetingUrl` là link Meet.
- Token bị vô hiệu khi người dùng bị khoá, bị xoá, hoặc `sessionVersion` thay đổi (đổi mật khẩu,
  admin đăng xuất mọi thiết bị) — giống cách phiên đăng nhập web đang làm.

### 5.2 Thư viện mới

| File | Việc |
|---|---|
| `lib/meetLink.ts` | `parseMeetCode(text)`: tách mã phòng từ mọi dạng link Meet (`?authuser=`, `/lookup/`, link nằm trong đoạn lời mời). Có test. |
| `lib/extensionAuth.ts` | Tạo token (32 byte ngẫu nhiên), băm, kiểm tra `Authorization: Bearer …`, trả về user như `requireUser()`. |
| `lib/meetings.ts` | Khi tạo/sửa cuộc họp: tự điền `meetCode` từ `meetingUrl`. |

### 5.3 API cho extension (thư mục `app/api/ext/`)

Tất cả nhận `Authorization: Bearer <token>`, trả JSON, chỉ cho phép origin
`chrome-extension://<id-extension>` (CORS).

| Route | Việc |
|---|---|
| `POST /api/ext/connect` | Gọi từ trang `/profile/extension` (đã đăng nhập bằng cookie): tạo token, trả cho extension qua `chrome.runtime.sendMessage` (`externally_connectable`). |
| `GET /api/ext/me` | Kiểm tra token còn dùng được, trả tên + avatar. |
| `GET /api/ext/meetings/lookup?code=abc-defg-hij` | Tìm cuộc họp có `meetCode` khớp, người dùng là người tổ chức / người ghi / người tham dự, trong khoảng ±3 giờ so với bây giờ. |
| `GET /api/ext/meetings/today` | Danh sách cuộc họp hôm nay của người dùng (khi không khớp mã phòng). |
| `POST /api/ext/meetings/quick` | Tạo nhanh cuộc họp (tên, giờ bắt đầu = bây giờ, link tab hiện tại). |
| `POST /api/ext/meetings/[id]/recap/check` | Bọc lại logic `/recap/check` hiện có. |
| `POST /api/ext/meetings/[id]/recap/upload` | Bọc lại `handleUpload` của Vercel Blob hiện có. |
| `POST /api/ext/meetings/[id]/recap` | Bọc lại route bắt đầu xử lý biên bản hiện có. |
| `POST /api/ext/tokens/revoke` | Extension tự thu hồi khi người dùng bấm "Ngắt kết nối". |

Cách làm: tách phần thân của 3 route `/api/meetings/[id]/recap/*` thành hàm nhận `user`,
để route cookie và route token gọi chung một hàm. Không chép logic.

Lưu ý upload: `upload()` của `@vercel/blob/client` gọi `handleUploadUrl`. Nếu không gắn được
header `Authorization` cho lời gọi đó, route `/ext/.../upload` sẽ nhận token qua `clientPayload`
(đã ký, hạn ngắn) thay vì header.

### 5.4 Giao diện app

- Trang **Hồ sơ → Extension ghi biên bản**: nút cài đặt, danh sách máy đã kết nối, nút thu hồi.
- Trang cuộc họp: dòng gợi ý "Họp online? Dùng extension để ghi 1 click" (chỉ hiện trên Chrome/Edge máy tính).
- Biên bản: ghi nguồn "Ghi bằng extension trên tab Google Meet".

---

## 6. Extension chi tiết

### 6.1 Cấu trúc thư mục

```
extension/
  manifest.json
  src/
    background.ts      // service worker: click, phím tắt, điều phối
    offscreen.html/.ts // thu âm, trộn, MediaRecorder, IndexedDB
    content-meet.ts    // chạy trên meet.google.com: mã phòng, trạng thái họp, gửi tin chat
    popup.html/.ts     // trạng thái, chọn cuộc họp, dừng
    options.html/.ts   // kết nối tài khoản, xin quyền micro, chọn micro
    api.ts             // gọi /api/ext/* kèm token
  build: esbuild → extension/dist (zip để nộp Web Store)
```

Dùng chung code thuần với app: `lib/meetingRecorder.ts` (chọn định dạng, tên file, bitrate 48 kbps,
thông báo lỗi micro) và `lib/meetLink.ts`.

### 6.2 manifest.json (quyền tối thiểu)

```json
{
  "manifest_version": 3,
  "name": "myCreative Recorder",
  "permissions": ["tabCapture", "offscreen", "storage", "activeTab", "alarms"],
  "host_permissions": ["https://taskflow-vert-psi.vercel.app/*"],
  "content_scripts": [{ "matches": ["https://meet.google.com/*"], "js": ["content-meet.js"] }],
  "externally_connectable": { "matches": ["https://taskflow-vert-psi.vercel.app/*"] },
  "commands": { "toggle-recording": { "suggested_key": { "default": "Alt+Shift+R" } } },
  "action": { "default_popup": "popup.html" }
}
```

Không xin `<all_urls>`, không đọc lịch sử duyệt web. Zoom/Teams web hoạt động nhờ `activeTab`
(chỉ tab người dùng vừa bấm).

### 6.3 Thu âm (phần kỹ thuật chính)

1. Người dùng bấm icon/phím tắt → service worker gọi
   `chrome.tabCapture.getMediaStreamId({ targetTabId })`. Lần bấm này chính là "cho phép",
   nên **không hiện bảng chọn tab**.
2. Service worker tạo **offscreen document** (lý do `USER_MEDIA`) và gửi `streamId` sang.
3. Offscreen:
   - `getUserMedia({ audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId } } })` → âm thanh tab.
   - `getUserMedia({ audio: { deviceId } })` → micro (đã xin quyền ở trang options).
   - **Phát lại âm thanh tab** qua `AudioContext.destination`. Không làm bước này thì Chrome tắt tiếng tab họp.
   - Trộn tab + micro bằng Web Audio → `MediaRecorder` Opus/WebM 48 kbps mono, cắt đoạn 5 giây.
   - Mỗi đoạn lưu ngay vào IndexedDB (giống `lib/recordingStore.ts`), nên Chrome lỗi hay máy tắt
     đột ngột vẫn còn phần đã ghi.
4. Badge trên icon hiện thời gian, cập nhật qua `chrome.alarms` (service worker MV3 có thể bị tắt
   khi rảnh; trạng thái lưu ở `chrome.storage.session`).

### 6.4 Tự dừng

- Người dùng bấm **Dừng**.
- Content script thấy đã rời phòng (màn hình "Bạn đã rời cuộc họp") → dừng sau 10 giây.
- Tab bị đóng (`chrome.tabs.onRemoved`).
- Chạm 225 phút (giới hạn hiện tại của app, ≈ 81 MB) → dừng và tải lên.
- Im lặng liên tục 15 phút → hỏi "Còn họp không?", không trả lời sau 2 phút thì dừng.

### 6.5 Tải lên

1. Ghép các đoạn thành một file `.webm`, tên theo `recordingFileName()`.
2. Gọi lần lượt `check` → `upload` (Vercel Blob, multipart nếu lớn) → `recap` (bắt đầu xử lý).
3. Lỗi mạng: thử lại theo nhịp 5 giây, 30 giây, 2 phút, rồi để nút **Gửi lại** trong popup.
   File chỉ bị xoá khỏi IndexedDB khi server xác nhận đã nhận.
4. Cuộc họp đã có biên bản: hỏi "Thay bản cũ hay huỷ?" (server vẫn chặn như hiện nay).

---

## 7. Minh bạch với người trong phòng

Không làm chế độ "thu ngầm". Lý do: giọng nói là dữ liệu cá nhân (Nghị định 13/2023/NĐ-CP),
ghi âm người khác cần họ biết; ngoài ra Chrome vẫn hiện biểu tượng đang ghi trên tab.

Cách làm vẫn giữ 1 click:

1. Khi bắt đầu ghi, content script gửi vào khung chat Meet:
   *"📝 myCreative đang ghi biên bản cuộc họp này (người ghi: Tên)."*
   Nếu không gửi được (Meet đổi giao diện) thì popup nhắc người dùng thông báo bằng lời. Ghi âm vẫn chạy.
2. Admin có thể bật/tắt câu thông báo tự động trong phần cài đặt app, nhưng mặc định **bật**.
3. Biên bản ghi rõ nguồn và thời điểm ghi.

---

## 8. Bảo mật và quyền riêng tư

- Token extension: chỉ lưu bản băm trên server; ở máy lưu trong `chrome.storage.local`.
  Thu hồi được từng máy. Tự hết hiệu lực khi tài khoản bị khoá/xoá hoặc đổi mật khẩu.
- Token chỉ dùng được cho `/api/ext/*`, không mở được trang web hay server action.
- File ghi âm: lưu Vercel Blob riêng tư, xoá sau khi làm xong biên bản (như hiện nay).
- Extension không gửi dữ liệu đi đâu khác ngoài tên miền myCreative.
- Content script chỉ đọc mã phòng và trạng thái họp, không đọc nội dung chat hay danh sách người tham dự.

---

## 9. Phát hành và cài đặt

1. Tạo tài khoản Chrome Web Store Developer (**5 USD, trả một lần**).
2. Nộp extension ở chế độ **Không công khai** (unlisted): chỉ người có link mới cài được.
   Google duyệt thường 1–3 ngày; quyền `tabCapture` có thể phải giải thích thêm mục đích.
3. Nếu công ty dùng Google Workspace: admin vào **Admin console → Chrome browser → Apps & extensions**,
   cài bắt buộc cho các phòng ban. Khi đó không ai phải tự cài.
4. Microsoft Edge: cài được thẳng từ Chrome Web Store, không cần nộp riêng.
5. Bản cập nhật: tăng `version`, build, nộp lại; Chrome tự cập nhật trên máy người dùng.

Biến môi trường mới trên Vercel: `EXTENSION_ID` (để kiểm tra CORS và `externally_connectable`).
Ghi hướng dẫn vào `DEPLOY.md`.

---

## 10. Chi phí

| Khoản | Chi phí |
|---|---|
| Tài khoản Chrome Web Store | 5 USD, một lần |
| Chép lời + viết biên bản | ≈ 0,17 USD/giờ họp (như hiện nay); ≈ 0,10 USD/giờ nếu đổi sang `whisper-large-v3-turbo` |
| Ví dụ 30 giờ họp/tháng | ≈ 5 USD/tháng |
| Vercel / Blob / Drive | Không tăng đáng kể (file ghi âm xoá sau xử lý) |
| Bảo trì | Sửa khi Meet đổi giao diện (chủ yếu phần gửi tin nhắn chat) |

---

## 11. Lộ trình triển khai

| Giai đoạn | Nội dung | Xong khi |
|---|---|---|
| **1. Nền tảng phía app** | Migration `meetCode` + `ExtensionToken`; `lib/meetLink.ts`; tự điền `meetCode`; tách logic 3 route recap thành hàm dùng chung | Test `parseMeetCode` và các route recap cũ vẫn chạy như trước |
| **2. API cho extension** | `/api/ext/*`, CORS, trang Hồ sơ → Extension (kết nối, danh sách máy, thu hồi) | Gọi được lookup/today/check/upload/recap bằng token qua `curl` |
| **3. Extension bản chạy được** | Manifest, service worker, offscreen thu tab + mic, IndexedDB, popup, tải lên | Ghi một cuộc Meet thật 10 phút → biên bản nháp xuất hiện trong app |
| **4. Bắt link + tự dừng** | Content script Meet: mã phòng, đổi màu icon, phát hiện rời phòng; phím tắt; chọn/tạo nhanh cuộc họp | Mở Meet từ lịch app → 1 click → đúng cuộc họp; rời phòng tự dừng |
| **5. Minh bạch + hoàn thiện** | Tin nhắn chat Meet, nhắc khi im lặng, thử lại khi mất mạng, Zoom/Teams web | Checklist kiểm thử mục 12 đạt |
| **6. Phát hành** | Icon, mô tả, chính sách quyền riêng tư, nộp Web Store, cập nhật `DEPLOY.md` | Có link cài; 2–3 người dùng thử một tuần |

Giai đoạn 1–2 làm trong repo hiện tại (một PR). Giai đoạn 3–5 nằm trong thư mục `extension/`
cùng repo (PR riêng). Giai đoạn 6 cần bạn tạo tài khoản Web Store.

---

## 12. Kiểm thử

**Test tự động (`npm test`)**

- `parseMeetCode`: link thường, có `?authuser=1`, có `?hs=`, link trong đoạn văn, mã sai.
- Token: tạo, băm, kiểm tra, thu hồi, hết hiệu lực khi đổi `sessionVersion` hoặc user bị xoá.
- Lookup: chỉ trả cuộc họp người dùng được xem, đúng khung giờ, cuộc họp đã huỷ không trả.

**Kiểm thử tay**

- [ ] Ghi Meet 10 phút, có người nói qua loa và qua micro → biên bản có lời cả hai bên.
- [ ] Tab Meet vẫn nghe được trong lúc ghi.
- [ ] Đóng tab giữa chừng → file vẫn được tải lên.
- [ ] Tắt Wi-Fi lúc tải lên → bật lại → tự gửi lại.
- [ ] Rời phòng → tự dừng sau 10 giây.
- [ ] Link Meet không có trong lịch → chọn cuộc họp hoặc tạo nhanh.
- [ ] Thu hồi token trên app → extension báo cần kết nối lại.
- [ ] Ghi 3 tiếng → file dưới 100 MB, biên bản chạy được.
- [ ] Zoom web và Teams web ghi được (chọn cuộc họp thủ công).
- [ ] Edge chạy giống Chrome.

---

## 13. Rủi ro và câu hỏi cần chốt

**Rủi ro**

| Rủi ro | Cách xử lý |
|---|---|
| Meet đổi giao diện → không gửi được tin chat / không phát hiện rời phòng | Chỉ ảnh hưởng tính năng phụ; ghi âm vẫn chạy. Có test tay mỗi lần Chrome lớn cập nhật. |
| Google từ chối/hỏi thêm khi duyệt quyền `tabCapture` | Mô tả rõ mục đích ghi biên bản, có thông báo minh bạch, có chính sách quyền riêng tư. |
| Service worker MV3 bị tắt khi rảnh | Việc thu âm nằm ở offscreen document; trạng thái lưu `chrome.storage.session`. |
| Người dùng chưa cấp quyền micro | Trang options xin quyền lúc cài; nếu thiếu thì vẫn ghi âm thanh tab và báo "chỉ có tiếng người khác". |
| Hai người cùng ghi một cuộc họp | Server đã chặn biên bản trùng; extension hỏi "Đã có người ghi, vẫn ghi dự phòng?". |

**Câu hỏi cần bạn chốt**

1. Công ty có dùng **Google Workspace** để admin cài sẵn extension cho mọi máy không, hay mỗi người tự cài?
2. Ai được dùng extension: **mọi nhân viên**, hay chỉ người tổ chức và người ghi biên bản của cuộc họp?
3. Câu thông báo tự động trong chat Meet: giữ mẫu ở mục 7 hay bạn muốn câu khác?
4. Có cần hỗ trợ **Zoom/Teams web** ngay từ bản đầu, hay chỉ Google Meet trước?
5. Tên hiển thị của extension: **myCreative Recorder** được không?
