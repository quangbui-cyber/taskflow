# 🏃 Kế hoạch: Run Club (kết nối Strava)

> Mục tiêu: cả công ty kết nối Strava, app tự ghi nhận km chạy bộ mỗi tháng, xếp hạng nhẹ nhàng
> và tự động gửi lời ghi nhận (Recognition) cho người dẫn đầu cuối tháng.
>
> Xem giao diện đề xuất: [`docs/run-club-preview.html`](./run-club-preview.html) (mở bằng trình duyệt).

---

## 0. ⚠️ Rủi ro cần xử lý trước khi code

| Rủi ro | Mô tả | Cách xử lý |
|---|---|---|
| **Giới hạn số người kết nối** | App Strava mới chỉ cho **1 athlete** (chính người tạo app) kết nối. | Gửi form xin nâng giới hạn (Strava duyệt mất vài ngày – vài tuần). |
| **Điều khoản hiển thị dữ liệu** | Từ cuối 2024 Strava siết điều khoản API; theo hiểu biết hiện tại, dữ liệu của một người có thể chỉ được hiển thị **cho chính người đó**. Bảng xếp hạng cho cả công ty xem có thể không được phép. *(Cần đọc lại điều khoản hiện hành — chưa xác minh.)* | Khi gửi form, ghi rõ: "Run Club nội bộ công ty, nhân viên tự nguyện kết nối và đồng ý hiển thị". |
| **Strava không duyệt** | — | **Phương án B:** nhân viên tự nhập km + ảnh chụp màn hình, admin duyệt. Toàn bộ giao diện & bảng xếp hạng (giai đoạn 3–5) dùng lại được, chỉ thay nguồn dữ liệu. |

👉 Giai đoạn 1 vẫn làm được trong lúc chờ duyệt (app mặc định cho 1 người kết nối để thử).

---

## 1. Luật chơi (cần chốt)

| Câu hỏi | Đề xuất mặc định |
|---|---|
| Tính môn gì? | Chỉ `Run`, `TrailRun`, `VirtualRun` (chạy máy) |
| Xếp hạng theo? | **Tổng km trong tháng** (hiển thị kèm số buổi, pace TB) |
| Tháng tính theo? | Giờ Việt Nam, theo `start_date` của hoạt động |
| Ghi nhận cuối tháng | Top 3 + mốc 50 km / 100 km |
| Chống gian lận | Bỏ hoạt động nhập tay (`manual: true`); đánh dấu nghi vấn nếu pace < 2:30/km để admin xem |
| Phương án B (nhập tay) | Chỉ làm nếu Strava không duyệt |

---

## 2. Các giai đoạn

### Giai đoạn 0 — Chuẩn bị (không code)
- [ ] Tạo app tại https://www.strava.com/settings/api — callback domain = domain production.
- [ ] Gửi form nâng giới hạn athlete + hỏi rõ về hiển thị bảng xếp hạng nội bộ.
- [ ] Khai báo env: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN`.
- [ ] Chốt luật chơi (mục 1).

### Giai đoạn 1 — Kết nối Strava (~0,5 ngày)
- **Prisma** — model mới:
  ```prisma
  model StravaConnection {
    id           String    @id @default(cuid())
    userId       String    @unique
    athleteId    BigInt    @unique
    refreshToken String    // đã mã hoá, giống User.googleToken
    accessToken  String
    expiresAt    DateTime
    scopes       String[]
    connectedAt  DateTime  @default(now())
    lastSyncAt   DateTime?
    lastError    String?
    user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  }
  ```
- **Route:**
  - `app/api/strava/connect` → chuyển tới trang cấp quyền Strava (scope `activity:read`).
  - `app/api/strava/callback` → đổi `code` lấy token, lưu (mã hoá refresh token).
  - `app/api/strava/disconnect` → gọi `deauthorize` + **xoá toàn bộ dữ liệu Run Club của người đó**.
- **`lib/strava.ts`:** tự làm mới access token (hết hạn ~6h), xử lý `429` (rate limit), log `lastError`.
- **`lib/features.ts`:** thêm `runClubEnabled()` (env `RUN_CLUB_ENABLED`), giống các flag hiện có.
- **UI `/profile`:** khối "Strava" — nút Kết nối / trạng thái / Ngắt kết nối.

### Giai đoạn 2 — Đồng bộ hoạt động (~1 ngày)
- **Prisma:**
  ```prisma
  model RunActivity {
    id          String   @id @default(cuid())
    stravaId    BigInt   @unique
    userId      String
    name        String
    type        String   // Run | TrailRun | VirtualRun
    distanceM   Int
    movingTimeS Int
    startDate   DateTime
    flagged     Boolean  @default(false) // pace bất thường, chờ admin xem
    excluded    Boolean  @default(false) // admin loại khỏi bảng xếp hạng
    createdAt   DateTime @default(now())
    user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
    @@index([startDate])
    @@index([userId, startDate])
  }
  ```
- **Webhook (kênh chính)** — `app/api/strava/webhook`:
  - `GET`: xác thực `hub.challenge` khi đăng ký subscription (1 subscription cho cả app).
  - `POST`: nhận sự kiện `activity create/update/delete` và `athlete deauthorize` → trả `200` ngay, rồi gọi API lấy chi tiết hoạt động.
- **Cron dự phòng** — `app/api/cron/strava-sync` (mỗi đêm): quét lại 7 ngày gần nhất cho từng người, bù sự kiện webhook bị lỡ.
- **Lần đầu kết nối:** chỉ kéo hoạt động **từ đầu tháng hiện tại**.
- **Lọc:** chỉ lưu môn hợp lệ, bỏ `manual`, bỏ hoạt động `private` / "Only me".

### Giai đoạn 3 — Trang `/run-club` (~0,5–1 ngày)
- Chọn tháng (dùng lại `monthKeyOf`, `monthRange`, `shiftMonth` từ `lib/gameLeaderboard.ts`).
- Tổng quan: tổng km cả công ty, số người tham gia, số buổi chạy.
- Bảng xếp hạng tháng: hạng · avatar · tên · km · số buổi · pace TB.
- "Của tôi": km tháng này, mốc tiếp theo, danh sách buổi chạy.
- Admin: xem & bỏ/giữ các hoạt động bị đánh dấu nghi vấn.
- Thêm mục "Run Club" vào `Sidebar`.

### Giai đoạn 4 — Ô trên Trang chủ (~0,25 ngày)
Tuân thủ nguyên tắc "Hiên nhà" (`docs/DESIGN_GUIDELINES.md`):
- Một `Card` nhỏ trong cột phải, cạnh "Góc giải trí": tổng km cả công ty + top 3 + km của bạn + link "Xem bảng xếp hạng".
- **Không** đếm ngược, **không** danh sách dài, **không** cảnh báo tụt hạng.
- Chưa kết nối: một dòng mời nhẹ "Tham gia Run Club".
- Dữ liệu đọc từ DB (một truy vấn `groupBy`), không gọi Strava → trang chủ không chậm thêm.

### Giai đoạn 5 — Ghi nhận cuối tháng (~0,25 ngày)
- Cron `app/api/cron/run-club-monthly` chạy ngày 1 hằng tháng:
  - Tạo `Recognition` cho top 3 tháng trước (category mới: `RUN_CLUB`).
  - Tuỳ chọn: ghi nhận người đạt mốc 50 / 100 km.
  - Gửi thông báo + web push chúc mừng (dùng hệ thống sẵn có).

---

## 3. Quyền riêng tư
- Chỉ người **chủ động kết nối** mới xuất hiện trên bảng xếp hạng.
- Chỉ lưu số liệu (km, thời gian, ngày, tên buổi chạy). **Không lưu bản đồ / GPS.**
- Bỏ qua hoạt động để chế độ riêng tư trên Strava.
- Ngắt kết nối → xoá sạch dữ liệu của người đó.

## 4. Hiệu năng & chi phí
- Không thêm thư viện: chỉ dùng `fetch` ở server.
- Trang chủ và `/run-club` chỉ đọc DB; việc gọi Strava chạy nền (webhook / cron).
- API Strava miễn phí; giới hạn mặc định ~100 request / 15 phút, 1.000 / ngày — webhook giúp dùng rất ít.
- Chi phí hạ tầng tăng không đáng kể.

## 5. Ước lượng

| Giai đoạn | Công sức |
|---|---|
| 0. Chuẩn bị | — (chờ Strava duyệt) |
| 1. Kết nối | ~0,5 ngày |
| 2. Đồng bộ + webhook | ~1 ngày |
| 3. Trang `/run-club` | ~0,5–1 ngày |
| 4. Ô trang chủ | ~0,25 ngày |
| 5. Ghi nhận tự động | ~0,25 ngày |
| **Tổng** | **~2,5–3 ngày** |

## 6. Kiểm thử
- Unit test (`tests/*.test.ts`): tính km theo tháng giờ VN, xếp hạng, lọc môn/manual, đánh dấu pace bất thường, làm mới token.
- Thử thật với 1 tài khoản Strava (giới hạn mặc định) trước khi mở cho cả công ty.
