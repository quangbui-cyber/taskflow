# Hướng dẫn đưa TaskFlow lên mạng cho cả công ty dùng

Mục tiêu: 30 nhân viên truy cập app qua một địa chỉ web, dữ liệu chung một nơi.
Cách làm dưới đây dùng **Vercel** (chạy app) + **Neon** (database PostgreSQL). Chi phí gói
miễn phí là đủ cho 30 người; tổng thời gian làm khoảng 30–45 phút.

---

## Bước 0 — Chuẩn bị (một lần)

Bạn cần 3 tài khoản miễn phí:

- **GitHub** — nơi chứa mã nguồn: https://github.com
- **Neon** — database PostgreSQL: https://neon.tech
- **Vercel** — chạy app: https://vercel.com (đăng nhập bằng chính GitHub cho tiện)

---

## Bước 1 — Đưa mã nguồn lên GitHub

Trong thư mục dự án, chạy:

```bash
git init
git add .
git commit -m "TaskFlow"
```

Tạo một repository mới (để **Private**) trên GitHub, rồi:

```bash
git remote add origin https://github.com/<tên-bạn>/taskflow.git
git branch -M main
git push -u origin main
```

> File `.env` đã được `.gitignore` bỏ qua nên **mật khẩu không bị đẩy lên GitHub** — đúng như mong muốn.

---

## Bước 2 — Tạo database trên Neon

1. Đăng nhập Neon → **Create project** → đặt tên `taskflow`, chọn region gần Việt Nam (ví dụ Singapore).
2. Sau khi tạo, Neon hiện **Connection string** dạng:
   ```
   postgresql://user:password@ep-abc-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
3. **Sao chép chuỗi này lại** — sẽ dán vào Vercel ở bước sau.

---

## Bước 3 — Deploy lên Vercel

Thông báo đẩy cần thêm ba biến môi trường Production: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (ví dụ `mailto:admin@congty.com`). Tạo khóa một lần bằng thư viện `web-push`; lưu private key dưới dạng Sensitive trên Vercel và giữ cặp khóa cố định qua các lần deploy. Sau khi thêm biến, triển khai lại app để bật tính năng. Migration tạo bảng thiết bị được chạy cùng quy trình production migrations hiện có. iPhone kiểm thử bằng bản HTTPS đã thêm vào Màn hình chính, tại **Thông báo → Bật thông báo → Gửi thông báo thử**.

1. Vào Vercel → **Add New → Project** → chọn repository `taskflow` vừa đẩy lên.
2. Vercel tự nhận diện Next.js. **Trước khi bấm Deploy**, mở phần **Environment Variables** và thêm:

   | Name             | Value                                                        |
   | ---------------- | ------------------------------------------------------------ |
   | `DATABASE_URL`   | (chuỗi kết nối Neon ở Bước 2)                                 |
   | `SESSION_SECRET` | (chuỗi ngẫu nhiên mới — xem cách tạo bên dưới)                |
   | `ADMIN_NAME`     | Tên admin, ví dụ `Nguyễn Văn A`                              |
   | `ADMIN_EMAIL`    | Email admin, ví dụ `admin@congty.com`                        |
   | `ADMIN_PASSWORD` | Mật khẩu admin mạnh                                          |
   | `TZ`             | `Asia/Ho_Chi_Minh` — để giờ hạn chót hiển thị đúng giờ VN     |

   Tạo `SESSION_SECRET` bằng lệnh (chạy trên máy bạn):
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

3. Bấm **Deploy**. Quá trình build sẽ **tự động tạo bảng trong database** (chạy `prisma migrate deploy`).
   Khi xong, Vercel cho bạn một địa chỉ như `https://taskflow-xyz.vercel.app`.

---

## Bước 4 — Tạo tài khoản admin đầu tiên

Database mới còn trống, cần tạo admin một lần. Trên **máy bạn**, trỏ tạm vào database Neon rồi seed:

```bash
# macOS / Linux
DATABASE_URL="<chuỗi-Neon>" \
SEED_MODE="admin" \
ADMIN_NAME="Nguyễn Văn A" \
ADMIN_EMAIL="admin@congty.com" \
ADMIN_PASSWORD="mật-khẩu-mạnh" \
npm run seed
```

Thấy dòng `Tài khoản Admin đã sẵn sàng` là xong. (Chỉ cần làm **một lần**.)

> Không chạy `npm run seed` trên production nếu thiếu `SEED_MODE=admin`, vì chế độ mặc định sẽ xoá dữ liệu cũ và tạo lại bộ dữ liệu mẫu.

---

## Bước 5 — Bàn giao cho công ty

1. Mở địa chỉ Vercel, đăng nhập bằng tài khoản admin vừa tạo.
2. Vào **Cài đặt → Tạo tài khoản** (góc dưới sidebar) → tạo tài khoản cho từng nhân viên
   (họ tên + email + mật khẩu tạm). Gửi thông tin đăng nhập cho họ.
3. Nhân viên đăng nhập, tạo project, thêm task, mời nhau vào project và làm việc.

> Muốn dùng tên miền riêng như `task.congty.com`? Vào Vercel → project → **Settings → Domains** → thêm domain và trỏ DNS theo hướng dẫn.

---

## Cập nhật app sau này

Mỗi lần sửa code, chỉ cần:

```bash
git add .
git commit -m "Mô tả thay đổi"
git push
```

Vercel **tự động build và cập nhật** bản chạy. Nếu có đổi cấu trúc database
(`prisma/schema.prisma`), tạo migration trước khi push:

```bash
npx prisma migrate dev --name ten_thay_doi
```

---

## Sao lưu & bảo mật

- **Sao lưu**: Neon tự động backup; ngoài ra có thể bật *Point-in-time restore* trong cài đặt project.
- **Đổi mật khẩu nhân viên**: admin vào trang Quản trị → **Đổi mật khẩu**.
- **Nhân viên nghỉ việc**: admin vào trang Quản trị → **Xoá** tài khoản đó.
- Không chia sẻ `DATABASE_URL` và `SESSION_SECRET` ra ngoài.

---

## Báo lên Google Chat (tuỳ chọn)

Khi có job mới, đổi người được giao hoặc đổi trạng thái, app gửi tin nhắn kèm người được giao và link mở đúng job vào group chat.

1. Mở **Google Chat** → vào **Space** (group) muốn nhận thông báo.
2. Bấm tên Space ở đầu trang → **Apps & integrations** → **Webhooks** → **Add webhooks**.
3. Đặt tên (ví dụ "myCreative") → **Save** → **Copy** URL webhook.
4. Trong myCreative, mở dự án cần kết nối → tab **Webhook** → dán URL → **Lưu webhook**.
5. Bấm **Gửi thử** để kiểm tra tin nhắn đã vào đúng Space.

Mỗi dự án có thể dùng một URL riêng để gửi vào một group riêng. URL được lưu kín
trong database và chỉ chủ dự án hoặc admin được thay đổi. Lỗi gửi tin nhắn (mạng,
webhook bị xoá...) không làm hỏng thao tác chính trong app.

> Lưu ý: webhook Google Chat chỉ gửi **một chiều** (app → group). Nhân viên trả
> lời trong group sẽ không phản hồi ngược lại app.

---

## Nhắc việc hàng ngày lúc 9h sáng (tuỳ chọn)

Mỗi sáng, app tự gửi vào group Chat của **từng dự án** một tin tổng hợp: việc
**quá hạn** và việc **đến hạn hôm nay** của chính dự án đó. Dự án không có việc
nào cần nhắc thì không gửi (không làm phiền group).

Cơ chế: [Vercel Cron](https://vercel.com/docs/cron-jobs) gọi route
`/api/cron/daily-digest`. Lịch khai báo sẵn trong `vercel.json`.

**Cần làm để bật:**

1. Đảm bảo dự án đã cấu hình webhook Chat (xem mục trên).
2. Tạo chuỗi bí mật bảo vệ endpoint:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
3. Vercel → Settings → Environment Variables → thêm `CRON_SECRET` = chuỗi vừa tạo → **Redeploy**.

Vercel tự gửi kèm `Authorization: Bearer <CRON_SECRET>` khi chạy cron; route đối
chiếu để chặn người lạ gọi bừa. **Chưa đặt `CRON_SECRET` thì endpoint luôn trả
401** — an toàn mặc định, nhưng cron cũng sẽ không chạy.

### Hai điều cần biết về lịch chạy

- **Cron của Vercel luôn theo giờ UTC.** Lịch đang đặt là `0 2 * * *` = **02:00 UTC
  = 9:00 giờ Việt Nam**. Nếu muốn đổi giờ, nhớ trừ đi 7 tiếng.
- **Độ chính xác tuỳ gói.** Dự án này đang chạy gói **Pro** nên cron chạy **đúng
  9:00 sáng**. Nếu sau này hạ về gói **Hobby**, tài liệu Vercel ghi rõ cron chỉ
  đảm bảo **±59 phút** (tin sẽ đến đâu đó trong khoảng 9:00–9:59) và chỉ cho
  phép chạy **1 lần/ngày**.

### Chạy thử

Cron không hoạt động với `next dev`. Muốn thử, gọi thẳng endpoint:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" \
  https://<app>.vercel.app/api/cron/daily-digest
```

> ⚠️ Endpoint này gửi tin **thật** vào group Chat của mọi dự án có việc trễ hạn.
> Đừng gọi thử trên production nếu chưa muốn cả công ty nhận tin nhắn.

## Email lịch họp và nghỉ phép qua Google Workspace (tuỳ chọn)

Trang **Lịch họp** luôn gửi thông báo trong app. Muốn người tham dự nhận thêm
**email kèm lịch (.ics)** khi được mời, khi đổi giờ/phòng và khi huỷ họp thì khai báo
một hộp thư Gmail hoặc Google Workspace để gửi. Trang **Nghỉ phép** dùng cùng
hộp thư: gửi xác nhận cho người xin và thông báo cho người duyệt khi có đơn mới;
gửi kết quả duyệt/từ chối cho người xin và quản lý nghỉ phép; khi hủy, báo người xin
và người duyệt (đơn đã duyệt thì báo thêm quản lý nghỉ phép). Email nghỉ phép gửi
riêng từng người nhận và bỏ qua tài khoản đã ngừng hoạt động.

1. Tạo (hoặc chọn) một tài khoản Gmail **dùng riêng cho app** — mail mời họp sẽ gửi
   đi từ địa chỉ này.
2. Bật **xác minh 2 bước** cho tài khoản đó, rồi tạo **Mật khẩu ứng dụng** tại
   <https://myaccount.google.com/apppasswords>.
3. Vercel → Settings → Environment Variables → thêm:
   - `SMTP_USER` = địa chỉ Gmail ở bước 1
   - `SMTP_APP_PASSWORD` = mật khẩu ứng dụng 16 ký tự ở bước 2, lưu dạng Secret/Sensitive
   - `SMTP_HOST` = `smtp.gmail.com`
   - `SMTP_PORT` = `465` (TLS trực tiếp) hoặc `587` (STARTTLS bắt buộc)
   - `MAIL_FROM_NAME` = `Creative Station` (tùy chọn)
   - `APP_URL` = địa chỉ app (không bắt buộc trên Vercel) để email có nút mở app
4. **Redeploy.**

Chưa khai báo thì app vẫn chạy bình thường, chỉ không gửi email.

Không dùng mật khẩu đăng nhập Google cho `SMTP_APP_PASSWORD`. Nếu không thấy mục
Mật khẩu ứng dụng, nhờ quản trị viên Workspace kiểm tra chính sách xác minh hai bước
và quyền dùng mật khẩu ứng dụng. Không đưa mã thật vào Git hoặc nội dung PR.

Email chạy sau khi thao tác lưu thành công; lỗi SMTP không làm mất đơn hoặc lịch đã đặt.
Lỗi gửi mail được ghi trong runtime logs bằng mã lỗi, không ghi mật khẩu hoặc nội dung thư.
Đây là gửi trực tiếp theo từng sự kiện, chưa có hàng đợi gửi lại khi máy chủ mail gặp lỗi.
Lịch họp bật mặc định ở mọi môi trường. Muốn tạm ẩn thì đặt `MEETINGS_ENABLED=false` rồi Redeploy.

- **Giới hạn của Gmail:** khoảng 500 người nhận/ngày với Gmail thường (2.000 với
  Google Workspace). Vượt mức, Google tạm khoá gửi khoảng 24 giờ.
- **Phản hồi tham dự** tính theo nút *Tham dự / Từ chối* trong app. Nút Yes/No trong
  Gmail chỉ gửi thư trả lời về hộp thư ở bước 1, không cập nhật vào app.
- **Phòng họp** do Admin thêm trong *Cài đặt → Phòng họp*.
- Cron 9h sáng (mục trên) nhắc thêm trong app các cuộc họp diễn ra trong ngày.

## Biên bản họp bằng AI (tuỳ chọn)

Người tổ chức **ghi âm ngay trong app** hoặc tải file ghi âm có sẵn lên trang **Biên bản** của cuộc họp
(ghi âm trong app cần HTTPS — Vercel có sẵn — và quyền micro: `Permissions-Policy` cho phép `microphone=(self)`).
Chế độ **Họp online** dùng tính năng chia sẻ tab của trình duyệt để thu thêm tiếng của tab Meet/Zoom — chỉ Chrome/Edge máy tính,
không cần cấu hình gì thêm.
App gửi file cho **Groq** (`whisper-large-v3`) để chép lời tiếng Việt, rồi nhờ
**Gemini** (`gemini-3.8-flash`, mức suy nghĩ `medium`) viết biên bản gồm tóm tắt, nội dung thảo luận chia theo
chủ đề, quyết định, việc cần làm (gắn sẵn người phụ trách trong danh sách mời) và vấn đề còn mở. Người tổ chức đọc lại, sửa nếu cần, rồi
bấm **Gửi cho người tham dự** (thông báo trong app + email nếu đã cấu hình email ở mục trên).

Chi phí tham khảo: khoảng **$0.17 cho mỗi giờ ghi âm** (Groq $0.111/giờ + Gemini khoảng
$0.05–0.07 mỗi lượt viết; từ 1/1/2027 Google tăng giá 3.8 Flash gấp đôi nên khoảng $0.10–0.14). File ghi âm chỉ nằm tạm trên Vercel Blob và **bị xoá ngay khi chép lời xong**;
app lưu lại bản chép lời và biên bản.

1. **Groq:** tạo API key tại <https://console.groq.com/keys>. Vào **Settings → Billing**
   chuyển sang gói **Developer** (trả theo dùng) để nhận file tới 100 MB.
2. **Gemini:** tạo API key tại <https://aistudio.google.com/apikey> và **bật thanh toán**
   cho project của key đó. Gói miễn phí cho phép Google dùng dữ liệu để cải thiện sản phẩm,
   không phù hợp với nội dung họp nội bộ.
3. **Vercel Blob:** Vercel → project → **Storage** → **Create** → **Blob** → chọn
   **Private** → kết nối với project (Production, Preview; thêm Development nếu chạy thử
   trên máy). Vercel tự thêm `BLOB_READ_WRITE_TOKEN` cùng các biến Blob khác.
4. Vercel → Settings → Environment Variables → thêm, lưu dạng Sensitive:
   - `GROQ_API_KEY`
   - `GEMINI_API_KEY`
5. **Redeploy.** Nút **Tạo biên bản** hiện trên các cuộc họp đã bắt đầu.

Thiếu một trong ba khoá (`GROQ_API_KEY`, `GEMINI_API_KEY`, `BLOB_READ_WRITE_TOKEN`) thì
nút tạo biên bản không hiện; biên bản đã có vẫn xem được. Muốn tắt hẳn thì đặt
`MEETING_RECAPS_ENABLED=false`. Đổi model không cần sửa code:
`RECAP_TRANSCRIBE_MODEL` (mặc định `whisper-large-v3`, rẻ hơn: `whisper-large-v3-turbo`)
và `RECAP_SUMMARY_MODEL` (mặc định `gemini-3.8-flash`; rẻ hơn nhưng kém hơn: `gemini-3.1-flash-lite`).

Cách Gemini viết biên bản:

- `RECAP_SUMMARY_THINKING`: mức "suy nghĩ" trước khi viết — `low`, `medium` (mặc định), `high`
  (`minimal` chỉ dùng với model Flash-Lite). Cao hơn thì gom chủ đề, đoán người phụ trách và ngày hạn
  kỹ hơn nhưng chậm và tốn hơn.
- `RECAP_SUMMARY_MAX_OUTPUT_TOKENS`: trần token trả về mỗi lượt, **đã gồm phần suy nghĩ**
  (mặc định 24576, nhận 4096–65536). Hết trần giữa chừng thì biên bản báo lỗi
  "AI dùng hết giới hạn token…" — tăng trần hoặc giảm mức suy nghĩ.
- Log server ghi số token mỗi lượt (`Gemini recap (…): input …, thinking …, output … tokens`)
  để đối chiếu chi phí và chỉnh hai biến trên.

- **Ai được làm gì:** người tổ chức và Admin tải ghi âm, sửa, viết lại, gửi, xoá biên bản.
  Người được mời chỉ đọc được **sau khi** biên bản được gửi.
- **Thời gian xử lý:** thường 1–3 phút cho một cuộc họp 1 giờ, chạy nền nên có thể rời trang.
  Lần xử lý quá 15 phút được coi là bị gián đoạn: người tổ chức tải file lên lại;
  cron 9h sáng cũng đánh dấu lỗi và xoá file ghi âm còn sót.
- **Giới hạn:** file tối đa 100 MB (mp3, m4a, wav, webm, ogg, flac, mp4). Ghi âm iPhone
  1 giờ khoảng 30–60 MB. Whisper không phân biệt người nói, nên biên bản không ghi
  "ai nói gì" chính xác.
- **Đoạn không nghe rõ:** Whisper đôi khi chép lại phần gợi ý tên (thay cho cả khung 30 giây lời nói thật)
  hoặc bị kẹt làm rơi chữ có dấu. App nhận ra các đoạn này, tự chép lại cả file **một lần nữa không kèm gợi ý**
  để lấy lại lời nói (chỉ khi có ít nhất 10 giây bị hỏng, còn hạn mức phút trong ngày và đủ thời gian), đoạn nào
  vẫn hỏng thì ghi `(không nghe rõ)` kèm khoảng thời gian. Trang biên bản báo số đoạn và tổng thời lượng bị mất.
  Lần chép lại tính vào tổng phút chép lời trong ngày nhưng không tính vào 3 lần chép lời của mỗi cuộc họp.
- **Quyền riêng tư:** nên báo trước cho người tham dự (nhất là khách hàng) rằng cuộc họp được ghi âm.
- **Thông báo khi họp bắt đầu:** cron `/api/cron/meeting-starts` chạy **mỗi phút** để báo người tổ chức
  "cuộc họp đã bắt đầu — bấm để ghi âm". Lịch chạy mỗi phút **cần gói Vercel Pro**; gói Hobby chỉ cho
  cron mỗi ngày một lần và sẽ **từ chối deploy** — khi đó xoá mục `meeting-starts` trong `vercel.json`.
  Cron dùng chung `CRON_SECRET` với cron 9h sáng.
- **Cuộc họp dự án:** họp tạo từ trang dự án được gắn với dự án; khi gửi, biên bản được lưu thành file
  `.docx` trong tài liệu dự án (gửi lại thì thay file cũ).

### Bản nháp và bản biên bản đã gửi

- Migration `20261023150000_recap_drafts_and_publication` thêm bản lưu nội dung và công việc đã gửi,
  đồng thời chuyển các biên bản đã gửi trước đây sang cơ chế này. Chạy migration trước khi phục vụ code mới;
  quy trình build production hiện có đã gọi `prisma migrate deploy`.
- Sửa nội dung, tải ghi âm mới hoặc viết lại chỉ thay bản nháp. Người tham dự tiếp tục đọc bản đã gửi
  cho tới khi người tổ chức bấm **Gửi lại**. Email và file Word lấy đúng bản đã công bố.
- Cuộc họp tạo ngoài dự án: trên trang biên bản bấm **Gắn vào dự án**, chọn dự án và bấm **Gắn và lưu biên bản**.
  Người tổ chức, người ghi biên bản hoặc Admin được thực hiện, kể cả khi họp đã kết thúc; người thao tác
  phải là thành viên dự án hoặc Admin. Bản đã gửi được lưu ngay, bản nháp đợi tới khi gửi. Các task đã tạo
  giữ nguyên dự án. Không hỗ trợ chuyển cuộc họp đã gắn sang dự án khác trong thao tác này.
- Viết lại giữ nguyên danh sách công việc, người phụ trách, hạn chót, dấu hoàn thành và liên kết task.
  Việc AI đề xuất thêm nằm trong **AI đề xuất bổ sung**; người tổ chức chọn **Thêm vào danh sách** hoặc **Bỏ qua**.
  Việc bổ sung chưa tạo task; tạo task vẫn là thao tác riêng.
- Kiểm thử PostgreSQL: tạo database cục bộ riêng có tên bắt đầu bằng `taskflow_recap_test`, chạy migrations vào
  database đó, rồi chạy `TASKFLOW_TEST_DATABASE_URL=postgresql://...@127.0.0.1:PORT/taskflow_recap_test npx tsx --test tests/recapWorkflow.integration.test.ts`.
  Bộ test từ chối URL không phải database thử nghiệm cục bộ. Không truyền database production.

### Chống chạy quá tay (giới hạn chi phí)

App tự chặn **trước khi** gọi AI, không có lần chạy nào tự lặp lại:

| Giới hạn | Mặc định | Đổi bằng biến môi trường |
|---|---|---|
| Độ dài tối đa mỗi file ghi âm | 180 phút | `RECAP_MAX_AUDIO_MINUTES` |
| Tổng phút chép lời mỗi ngày (cả công ty) | 600 phút ≈ tối đa $1.1/ngày | `RECAP_DAILY_AUDIO_MINUTES` |
| Tổng lượt viết biên bản mỗi ngày (cả công ty) | 60 lượt ≈ tối đa $9/ngày (từ 2027 ≈ $18) | `RECAP_DAILY_SUMMARIES` |
| Mỗi cuộc họp mỗi ngày | chép lời 3 lần, viết biên bản 6 lần | — |

- Mỗi lượt Gemini bị giới hạn 8.192 token trả về và tối đa khoảng 5 giờ nội dung đầu vào.
- Groq/Gemini báo bận (429) hoặc lỗi máy chủ (5xx) thì thử lại tối đa 3 lần; **quá thời gian
  chờ thì không thử lại** (có thể đã bị tính tiền). Không có hàng đợi hay cron nào tự chạy lại.
- Hết hạn mức thì người dùng thấy lý do bằng tiếng Việt; ngày mới (0h giờ Việt Nam) tự mở lại.
- `MEETING_RECAPS_ENABLED=false` rồi Redeploy là tắt hẳn ngay.

Nên đặt thêm **trần chi tiêu ở phía nhà cung cấp** — lớp bảo vệ cuối cùng, kể cả khi code có lỗi:

1. **Groq:** Console → **Settings → Billing → Limits** → nhập trần theo tháng (ví dụ $10),
   bật email cảnh báo ở 50% / 75% / 90%. Chạm trần là Groq chặn mọi lời gọi tới đầu tháng sau.
2. **Gemini:** Google AI Studio → tab **Spend** của project → đặt trần theo tháng (ví dụ $5).
   Trần có hiệu lực sau khoảng 10 phút.
3. **Vercel:** gói Hobby tự dừng khi vượt mức miễn phí, không tính thêm tiền. Gói Pro: bật
   **Spend Management** (Settings → Billing) để nhận cảnh báo hoặc tạm dừng dự án.
