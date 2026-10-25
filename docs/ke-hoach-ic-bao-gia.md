# Kế hoạch: Tài chính dự án — Báo giá, Nghiệm thu, IC, AC, Tạm ứng, Thanh toán, Hoàn ứng

> Trạng thái: **kế hoạch đã chốt phần lớn, chưa code.**
> File mẫu đã phân tích:
> - `AC_JABIL FIGURE_22.09.2026.xlsx` — **mẫu chuẩn** (Báo giá + Nghiệm thu + IC + AC trong một sheet, kèm sheet minh chứng)
> - `IC_VIETJET CHUYẾN BAY ĐỒNG HÀNH _1007.xlsx` — IC giai đoạn đầu (Báo giá + IC)
> - `ĐNTU-CS.2024`, `ĐNTT-CS.2024`, `ĐNHTU-CS.2024` — mẫu phiếu của công ty
> - Chưa đọc được: `IC - EVENT.xlsx` (bị khoá mật khẩu; không bắt buộc vì đã có file AC Jabil làm mẫu)

## 1. Quyết định đã chốt

| # | Nội dung |
|---|---|
| Q1 | **Account** nộp IC và AC. **Người duyệt đặt theo từng dự án**; người duyệt IC có thể khác người duyệt AC. Duyệt xong chuyển **Kế toán** để chi. |
| Q2 | Thêm vai trò **Kế toán**. |
| Q3 | **USER xem được IC nhưng bị ẩn giá bán, lợi nhuận, margin, Báo giá và Nghiệm thu.** USER chỉ thấy giá vốn và ngân sách. |
| Q4 | Lưu **danh bạ nhà cung cấp** (kể cả số tài khoản), **mọi người xem được**. |
| Q5 | Phiếu in theo **mẫu công ty** ĐNTU/ĐNTT/ĐNHTU-CS.2024. |
| Q6 | **Trước khi AC được duyệt chỉ có Đề nghị tạm ứng.** Sau khi AC duyệt mới có **Đề nghị thanh toán** và **Đề nghị hoàn tạm ứng**. |
| Q7 | **Mọi file xuất ra luôn có logo Creative Station**, kể cả khi file Excel gốc không có. |
| Q8 | **Giám đốc không duyệt trong app**, nhưng phiếu in ra **vẫn có chỗ ký Giám đốc** như mẫu. |
| Q9 | **Doanh thu dự án tính sau VAT.** |
| Q10 | **Chưa đặt ngưỡng** margin / % AC vượt IC. Các luật dùng ngưỡng tạm tắt, bật lại khi có số. |
| Q11 | Đánh số phiếu và điều kiện lập tạm ứng: **app tự đề xuất** (mục 6). |
| Q12 | **Thông tin chung chuẩn hoá** cho Báo giá, IC, AC: **Khách hàng · Tên chương trình · Số lượng · Địa điểm · Thời gian**. Mục nào để trống thì **tự ẩn khi xuất Excel/PDF**. |
| Q13 | **Chứng từ gắn theo nhà cung cấp** (không gắn theo từng dòng). **Không phân loại** chứng từ: chỉ cần biết NCC **có hay chưa có** chứng từ và **tên file** đã tải lên. Bảng tài chính có **2 cách xem: theo hạng mục và theo nhà cung cấp**. |
| Q14 | **Xem chứng từ ngay trong app, không cần tải về**: ảnh và PDF mở trực tiếp; Excel hiện dạng bảng chỉ đọc; loại khác thì tải về. |
| Q15 | ~~Sao lưu chứng từ: thùng rác 30 ngày trong app + sao lưu hằng đêm sang Google Shared Drive~~ → thay bằng Q18 (lưu thẳng trên Shared Drive, thùng rác Drive 30 ngày). **Không** gửi bộ hồ sơ qua email. |
| Q16 | Một người **được** vừa duyệt vừa bấm "Đã chi" cùng một phiếu, nhưng app **ghi lại trong lịch sử và hiện cảnh báo** (mục Phân quyền). Admin kiêm kế toán giữ vai trò Admin + bật ô "Nhận việc kế toán". |
| Q17 | **Thông báo duyệt gửi qua email thay cho Google Chat.** Khi gửi duyệt, người gửi chọn người nhận: **To** = người duyệt, **CC** = người liên quan tự chọn. Kết quả duyệt/từ chối trả lời trong cùng luồng email. |
| Q18 | **Hồ sơ lưu trên Google Shared Drive của công ty** (đã chốt 2026-10-25, thay cho Vercel Blob + sao lưu hằng đêm). App kết nối Drive bằng tài khoản `noreply@creativestation.vn`; chỉ tài khoản này là thành viên (Manager) của Shared Drive. |
| Q19 | **Mọi hồ sơ xếp theo từng dự án**, kể cả chứng từ NCC: mở thư mục một dự án là thấy đủ IC, AC, phiếu và chứng từ của mọi NCC trong dự án đó. |
| Q20 | **Quyền xem trên Drive do app cấp và thu hồi tự động** theo thành viên dự án và vai trò (Admin, Kế toán, người duyệt). |
| Q21 | **Mọi file tải lên trong dự án cũng lưu trên Shared Drive** (chốt 2026-10-25): tab Tài liệu dự án và tệp giao việc / kết quả của task, không chỉ hồ sơ tài chính. File cũ đang nằm trong database được chuyển sang Drive một lần rồi xoá khỏi database. |

### Chứng từ và cách xem (Q13, Q14)

- **Chứng từ gắn theo nhà cung cấp** của dự án, không gắn theo dòng chi phí. Mỗi NCC trong dự án có một bộ file.
- **Không phân loại**: chỉ lưu tên file, người tải, ngày tải, dung lượng. Trạng thái của NCC chỉ có **"Có chứng từ · N file"** hoặc **"Chưa có chứng từ"**.
- **Theo hạng mục** (demo màn 7): bảng chi phí, cột cuối hiện chứng từ của NCC dòng đó (có/chưa có, số file). Bấm một dòng thì khung bên phải hiện bộ chứng từ của NCC đó, kèm chỗ thêm file.
- **Theo nhà cung cấp** (demo màn 8): danh sách NCC (AC, còn phải trả, có/chưa có chứng từ). Bấm một NCC để xem:
  - IC, AC, chênh lệch, đã tạm ứng, còn phải trả;
  - danh sách file kèm nút Xem / Tải về / Xoá, và ô kéo thả để tải nhiều file một lúc;
  - các dòng chi phí của NCC đó;
  - lịch sử tạm ứng, và nút lập phiếu tiếp theo với số tiền đã tính sẵn.
- NCC chưa có chứng từ: **chỉ nhắc** (dòng vàng đầu bảng), không chặn lập phiếu hay gửi duyệt.
- File lưu trên Shared Drive trong thư mục `Chứng từ NCC/<NCC>` của dự án (Q18, Q19); tab Tài liệu của dự án cũng thấy.
- **Không có giá bán** trong 2 màn hình này, nên USER xem được (Q3).

**Xem file trong app (Q14, demo màn 9)**: bấm "Xem" mở khung xem toàn màn hình, có nút qua file trước/sau, "Mở tab mới", "Tải về".

| Loại file | Cách xem |
|---|---|
| Ảnh (JPG, PNG, WebP, HEIC đã đổi sang JPG) | Hiện thẳng, có Vừa khung / Phóng to / Xoay |
| PDF | Dùng trình xem PDF có sẵn của trình duyệt (cuộn trang, phóng to) |
| Excel (.xlsx, .xls, .csv) | Máy chủ đọc file và hiện **dạng bảng chỉ đọc**, có chuyển sheet; giữ chữ, số, ô gộp. Không hiện biểu đồ, ảnh chèn, màu ô |
| Loại khác (Word…) | Báo "chưa xem trước được" và cho tải về |

**Lưu hồ sơ trên Google Shared Drive (Q18–Q20):**

- **Nơi lưu chính** là Shared Drive của công ty (không dùng "Drive của tôi" của một người, để file thuộc về công ty). Database chỉ giữ tên file, dung lượng, người tải, `driveFileId` và đường dẫn.
- App kết nối Drive **một lần** bằng tài khoản `noreply@creativestation.vn` (Admin bấm "Kết nối Google Drive" ở trang Cài đặt). Token được mã hoá như kết nối Gmail/Meet đang có. Mất kết nối (đổi mật khẩu, thu hồi quyền) thì app báo Admin kết nối lại.
- Quyền xin: **toàn quyền Google Drive (`drive`) trên riêng tài khoản `noreply@`** (đổi 2026-10-28). Quyền hẹp `drive.file` không cho tạo thư mục trong Shared Drive có sẵn. Rủi ro thấp vì `noreply@` chỉ là thành viên của Shared Drive này, không giữ file nào khác. Nhân viên không phải cấp quyền gì.
- Thành viên của cả Shared Drive **chỉ có noreply** (đã chốt 2026-10-25, không thêm Admin). Mọi người khác, kể cả Admin, được app share **từng thư mục dự án** theo bảng phân quyền dưới.

**Cấu trúc thư mục — tất cả theo dự án (Q19):**

```
myCreative – Dự án/                (Shared Drive)
  2026/
    <Mã dự án> – <Tên dự án>/
      Tài liệu/                      ← tab Tài liệu dự án (PO, brief, thông tin khách hàng) — thành viên dự án
      Công việc/                     ← thành viên dự án
        <Tên task>/   tệp giao việc và tệp kết quả của task
      Tài chính/                     ← chỉ Admin, Kế toán, người duyệt của dự án
        Báo giá, IC, AC (mỗi loại một file, xuất lại thì ghi đè; Drive giữ lịch sử phiên bản)
        Phiếu/  ĐNTU, ĐNTT, ĐNHTU
      Chứng từ NCC/                  ← thành viên dự án
        <Tên NCC>/   hoá đơn, minh chứng của NCC đó trong dự án này
```

- Trong app, chứng từ vẫn gắn theo cặp **(dự án, NCC)** như `SupplierDocument`. Thư mục `Chứng từ NCC/<NCC>` tạo khi NCC có file đầu tiên.
- Muốn xem mọi dự án của một NCC thì xem trong app (trang NCC lọc theo `supplierId`), không cần thư mục riêng trên Drive.
- File IC/AC/phiếu do app xuất (luôn có logo, mẫu CS.2024) được đẩy lên Drive ngay khi tạo/duyệt. Chứng từ người dùng tải lên được trình duyệt đẩy thẳng lên Drive (tải lên nối tiếp, không giới hạn 4 MB), ảnh điện thoại vẫn thu nhỏ trước khi tải.

**File dự án và file task (Q21):**

Hiện nay (2026-10-25) cả hai loại file lưu **nguyên nội dung trong database** (`ProjectFile.data`, `TaskFile.data`, tối đa 4 MB mỗi file). Database Neon gói miễn phí chỉ khoảng 0,5 GB nên về lâu dài sẽ đầy, và mỗi lần đọc file đều đi qua database.

- **File mới**: trình duyệt xin máy chủ một phiên tải lên Drive (máy chủ kiểm quyền thành viên dự án, tạo thư mục nếu chưa có), rồi đẩy thẳng file lên Drive. Xong thì máy chủ lưu bản ghi `ProjectFile` / `TaskFile` gồm tên, loại, dung lượng, người tải và `driveFileId`; **không còn cột `data`**.
- **Bỏ giới hạn 4 MB**, đặt trần mới (đề xuất 100 MB mỗi file). Thêm được loại file thiết kế (AI, PSD, ZIP, MP4…) nếu cần, quyết khi code.
- **Mở xem**: mở bằng trình xem của Google Drive (cả Word, PowerPoint, Excel). Người không mở được Drive (Gmail cá nhân khi công ty chặn chia sẻ ra ngoài) vẫn **tải về qua app** như hiện nay: đường dẫn trong app kiểm quyền rồi lấy file từ Drive trả về.
- **Xoá** trong app: chuyển file trên Drive vào thùng rác (30 ngày), giữ quy tắc ai được xoá như hiện tại.
- **Thư mục task** tạo khi task có file đầu tiên; đổi tên task thì đổi tên thư mục; xoá task thì chuyển thư mục vào thùng rác.
- Các chỗ code đang đọc/ghi nội dung file phải đổi theo: `app/api/projects/[id]/files/*`, `app/api/tasks/[taskId]/files/*`, `app/actions/projects.ts`, `lib/financeImportSave.ts` (file Excel IC nhập vào), `lib/recapProject.ts` (biên bản họp lưu vào tài liệu dự án).

**Chuyển file cũ sang Drive (làm một lần):**
1. Thêm cột `driveFileId` (cho phép trống) vào `ProjectFile` và `TaskFile`; tạm giữ cột `data`.
2. Chạy script chuyển: đọc từng file còn `driveFileId` trống, tạo thư mục dự án / task, tải lên Drive, ghi `driveFileId`. Chạy lại được nhiều lần, file đã chuyển thì bỏ qua; file lỗi ghi lại để chạy lại.
3. Trong lúc chuyển, app đọc file từ Drive nếu đã có `driveFileId`, chưa có thì đọc từ `data` như cũ, nên **không phải tạm dừng app**.
4. Kiểm tra: số file và tổng dung lượng trên Drive khớp với database; mở thử vài file mỗi loại.
5. Sau khi Admin xác nhận, migration thứ hai **xoá cột `data`** để giải phóng database. Trước bước này, sao lưu database (Neon branch hoặc bản dump).
6. Share thư mục cho thành viên các dự án hiện có (chạy cùng lúc đối chiếu quyền hằng đêm).

**Phân quyền share tự động (Q20):**

| Sự kiện trong app | Việc app làm trên Drive |
|---|---|
| Thêm người vào dự án | Share thư mục dự án (trừ `Tài chính/`) quyền **Xem** |
| Gỡ người khỏi dự án, khoá hoặc xoá tài khoản | Thu hồi quyền ở thư mục dự án |
| Vai trò Admin / Kế toán, người duyệt IC/AC của dự án | Share thêm `Tài chính/` quyền **Xem** (Kế toán: **Chỉnh sửa**) |
| Đổi người duyệt | Thu hồi người cũ, cấp người mới |

- Share không gửi email thông báo của Google (`sendNotificationEmail=false`).
- Trang dự án có mục **"Ai đang có quyền trên Drive"**, Admin thêm/gỡ thủ công được.
- Mỗi đêm cron đối chiếu quyền trên Drive với app và sửa chỗ lệch (ví dụ ai đó share tay).
- Chỉ share được cho tài khoản Google. Email ngoài `@creativestation.vn` (Gmail cá nhân) chỉ được nếu Workspace cho phép chia sẻ ra ngoài tên miền.

**Xoá và khôi phục:**
- Xoá file trong app: chuyển vào thùng rác của Drive (giữ 30 ngày, Admin khôi phục được), không xoá hẳn.
- Kết quả kiểm tra 2026-10-25: tài khoản `quang.bui@creativestation.vn` đã thấy một Shared Drive (tạo 2024-10-15) và có quyền thêm file, nên gói Workspace của công ty **có hỗ trợ Shared Drive**.

**Việc cần làm một lần trước khi code:**
1. ✅ (2026-10-25) Đã tạo Shared Drive "myCreative – Dự án" bằng tài khoản `noreply@creativestation.vn` (Manager). ID: `0AL-5HJ8czOkOUk9PVA` — dùng làm biến môi trường `GOOGLE_DRIVE_SHARED_DRIVE_ID`.
2. ✅ (2026-10-25) Đã bật **Google Drive API** trong dự án Google Cloud "My First Project" (`arched-aleph-512615-p1`, số 723564408506), là dự án của OAuth client "myCreative web".
   ✅ (2026-10-25) Cũng đã bật **Google Sheets API** và **Google Docs API** trong cùng dự án, để app tạo/sửa IC, AC dạng Google Sheets và văn bản dạng Google Docs. Dùng chung quyền Drive của tài khoản `noreply@`.
3. Bật xác minh 2 bước cho `noreply@`.
4. Kiểm tra chính sách chia sẻ ra ngoài tên miền trong Admin Console.

Cách làm kỹ thuật:
- Đường dẫn file hiện nay luôn trả về dạng **tải xuống**. Thêm chế độ **xem** (`?view=1`) trả về dạng mở trực tiếp, **chỉ cho ảnh và PDF**. Kèm header chống chạy mã (`X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`), vẫn kiểm quyền như cũ.
- Excel: thêm đường dẫn trả về nội dung bảng (JSON) để giao diện tự vẽ. Không mở file Excel trực tiếp trong trình duyệt, và **không dùng trình xem của Microsoft/Google** vì phải đưa file ra ngoài qua đường dẫn công khai.

### Thông tin chung (Q12)

| Mục | Điền sẵn khi tạo IC | Ghi chú |
|---|---|---|
| Khách hàng | Client của dự án | sửa được |
| Tên chương trình | Tên dự án | sửa được |
| Số lượng | — | ghi tự do để giữ đơn vị, vd "240 khách", "68 tượng" |
| Địa điểm | — | |
| Thời gian | Ngày thực hiện của dự án | 1 ngày: `22/09/2026`; nhiều ngày: `01/08 – 03/08/2026` |

- Thứ tự in cố định như bảng. Mục trống **không in ra** (không để "Chưa có" hay dòng kẻ trống).
- Trong app vẫn nhắc nhẹ mục còn trống, nhưng **không chặn** gửi duyệt hay xuất file.
- Code dùng chung: `lib/financeHeader.ts` (đã viết, có test `tests/financeHeader.test.ts`).

## 2. Cấu trúc file IC/AC của công ty (theo file AC Jabil)

Một sheet có 4 khối nằm ngang, cùng hàng = cùng hạng mục:

| Khối | Cột | Nội dung | Ai thấy |
|---|---|---|---|
| **BÁO GIÁ** | A–H | STT, Hạng mục, Mô tả, ĐVT, SL, Đơn giá, Thành tiền, Ghi chú | ẩn với USER |
| **NGHIỆM THU** | J–Q | Như báo giá, là số **khách chấp nhận sau chương trình** | ẩn với USER |
| **INTERNAL COST (IC)** | S–Y | ĐVT, SL, Đơn giá, Thành tiền, VAT, Tổng, **SUP** (NCC) | mọi thành viên |
| **ACTUAL COST (AC)** | AA–AG | Như IC nhưng là số thực tế | mọi thành viên |
| Tổng hợp NCC | AI–AM | NCC, Tổng phải trả, **Tạm ứng** (theo ngày), **Sau chương trình**, Thông tin chuyển khoản | mọi thành viên |

Đặc điểm cần hỗ trợ:
- **Một hạng mục bán có nhiều dòng chi phí con.** Ví dụ "Tượng 3D quà tặng" bán 68 × 2.000.000, chi phí gồm sản xuất tượng (ARTECH), sản xuất bục (Tân Hoàng Việt), đổi mặt phiên bản.
- **Dòng chi phí không tính tiền khách** (giá bán ghi "-"): vận chuyển, Project Leader, Supporter.
- **Giá bán nhập theo giá đã gồm VAT** rồi chia 1,08 (`=2160000/1.08`).
- **Sheet minh chứng** cho từng NCC/khoản chi (ARTECH, Tân Hoàng Việt, Logistic) gồm ảnh hoá đơn và bảng chi tiết — trong app thành **bộ chứng từ của NCC** (Q13). Sheet Logistic có cả *đã tạm ứng* và *thanh toán bổ sung*.
- File Jabil tạm ứng ARTECH bằng `(tổng − khoản nhỏ)/2`; trong app **số tạm ứng do người lập nhập**, không tự tính.
- NCC ghi bằng **tên gọi tắt** ("HUY", "A.QUANG"), thông tin chuyển khoản đầy đủ nằm ở cột AM.

File Vietjet là cùng mẫu ở giai đoạn đầu (chỉ có Báo giá + IC).

Số liệu file Jabil: bán 136.000.000 (146.880.000 gồm VAT) · IC 103.914.222 → lãi 32.085.778 (23,6%) · AC 106.704.222 → lãi 29.295.778 (21,5%).

## 3. Vòng đời tiền của một dự án

```
1. IC        Account lập Báo giá + IC → Người duyệt IC duyệt → khoá IC
                 doanh thu dự án = tổng Báo giá GỒM VAT
2. Báo giá   xuất cho khách (PDF/Excel có logo)
3. ĐNTU      tạm ứng theo dòng IC / theo NCC → người duyệt → Kế toán chi
4. AC        Account nhập Nghiệm thu + chi phí thực tế + minh chứng → Người duyệt AC duyệt → khoá
                 doanh thu dự án = tổng Nghiệm thu GỒM VAT
5. ĐNHTU     người đã tạm ứng quyết toán: thực tế − đã ứng → bổ sung hoặc thu hoàn
   ĐNTT      thanh toán phần thực tế chưa ứng (chuyển khoản NCC…)
6. Đóng      khi mọi tạm ứng đã hoàn và mọi khoản đã chi
```

## 4. Vị trí trong app

- **Trang dự án → tab "Tài chính"** (sau tab Task). Phần con:
  **Bảng tài chính** (4 khối như Excel, bật/tắt từng khối) · **Báo giá** · **Tạm ứng** · **Thanh toán & Hoàn ứng** · **Nhà cung cấp** (tổng hợp như cột AI–AM) · **Phiên bản**.
- **Thanh bên → "Đề nghị chi"**: *Của tôi* · *Chờ tôi duyệt* · *Chờ chi* (Kế toán).
- **Đầu trang dự án**: doanh thu (sau VAT), trạng thái IC/AC; margin chỉ người được phép mới thấy.
- **Sửa dự án**: chọn **Người duyệt IC** và **Người duyệt AC**.
- **Doanh số**: thêm lợi nhuận dự kiến (IC) và thực tế (AC).

## 5. Phân quyền

| Việc | USER | ACCOUNT | Người duyệt dự án | KẾ TOÁN | ADMIN |
|---|---|---|---|---|---|
| Xem IC, AC (giá vốn, ngân sách, NCC) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Xem Báo giá, Nghiệm thu, lợi nhuận, margin | — | ✓ | ✓ | ✓ | ✓ |
| Tạo / sửa IC, AC | — | ✓ | — | — | ✓ |
| Duyệt IC / AC | — | — | ✓ | — | ✓ |
| Lập ĐNTU, ĐNHTU, ĐNTT | ✓ (của mình) | ✓ | ✓ | — | ✓ |
| Duyệt phiếu | — | — | ✓ | — | ✓ |
| Bấm "Đã chi" / "Đã thu hoàn" | — | — | — | ✓ | ✓ |
| Xem danh bạ NCC (kể cả STK) | ✓ | ✓ | ✓ | ✓ | ✓ |

Ẩn dữ liệu **ở server**: API chỉ trả cột giá bán/lợi nhuận/margin cho vai trò được phép. File Excel xuất cho USER cũng không có các cột này.

**Một người vừa là Admin vừa làm Kế toán:**
- Mỗi tài khoản chỉ có **một vai trò**. Admin đã có sẵn mọi quyền của Kế toán (xem số liệu, bấm "Đã chi", xoá nhà cung cấp), nên người đó **giữ vai trò Admin**.
- Thêm một **ô đánh dấu "Nhận việc kế toán"** cho tài khoản, làm giống ô "Quản lý nghỉ phép" đang có. Người có vai trò Kế toán thì luôn nhận việc kế toán; Admin bật ô này thì cũng nhận.
- Hộp **"Chờ chi"** và thông báo "phiếu đã duyệt, chờ chi" gửi tới **mọi người nhận việc kế toán**, không chỉ người có vai trò Kế toán.
- Không làm nhiều vai trò cho một tài khoản: phải sửa mọi chỗ kiểm quyền trong app mà không thêm được gì, vì Admin đã bao gồm Kế toán.
- Làm cùng Giai đoạn 5 (lúc có hộp "Chờ chi").

**Cùng một người vừa duyệt vừa bấm "Đã chi" (Q16): cho phép, nhưng ghi lại và cảnh báo.**
- Khi người bấm "Đã chi" cũng là người đã duyệt phiếu đó, app hiện hộp xác nhận: *"Bạn cũng là người duyệt phiếu này. Không có người thứ hai kiểm tra trước khi chi. Vẫn xác nhận đã chi?"*
- Lịch sử phiếu (`ApprovalEvent`) ghi rõ: *"Duyệt và chi cùng một người"*. Phiếu mang nhãn nhỏ **"Tự duyệt – tự chi"** ở hộp "Chờ chi", danh sách phiếu và trang Thanh toán của dự án.
- Trang Đề nghị chi có bộ lọc **"Tự duyệt – tự chi"** để Admin rà lại định kỳ.
- Áp dụng cho mọi loại phiếu (ĐNTU, ĐNTT, ĐNHTU).

## 6. Đề xuất của app (Q11)

**Đánh số phiếu**: `<loại>-<năm>-<số thứ tự 4 chữ số>`, đếm riêng từng loại, bắt đầu lại mỗi năm. Số đã cấp không dùng lại, kể cả khi phiếu bị huỷ.

| Loại | Ví dụ | Mẫu in |
|---|---|---|
| Đề nghị tạm ứng | `TU-2026-0001` | ĐNTU-CS.2024 |
| Đề nghị thanh toán | `TT-2026-0001` | ĐNTT-CS.2024 |
| Đề nghị hoàn tạm ứng | `HTU-2026-0001` | ĐNHTU-CS.2024 |
| IC / AC | `IC v1`, `AC v1` trong từng dự án | — |

**Điều kiện lập tạm ứng**:
- Cần **IC đã duyệt** (để có ngân sách mà trừ).
- Tạm ứng chọn theo **NCC/dòng IC**: app hiện tổng phải trả theo IC và số đã ứng trước đó để tham khảo. **Số tiền tạm ứng do người lập nhập**, app không điền sẵn.
- Vượt ngân sách còn lại của NCC/dòng IC thì **cảnh báo, không chặn**.
- Mỗi phiếu tạm ứng bắt buộc có **ngày hoàn tạm ứng**, mặc định **7 ngày sau ngày kết thúc dự án**.

## 7. Mẫu phiếu của công ty

Cả 3 mẫu có: logo + dải xanh `creativestation.com.vn`, mã mẫu ở góc phải, "Bằng chữ", ngày lập, 4 chỗ ký **Kế toán/tài chính · Phụ trách bộ phận · Người lập/Trưởng dự án · Giám đốc** (Q8: chỉ in, không duyệt trong app).

| Mẫu | Đầu phiếu | Cột |
|---|---|---|
| **ĐNTU** | Người xin tạm ứng, SĐT, Dự án, Ngày hoàn tạm ứng, cam kết *"không hoàn đúng hạn thì không nhận bonus chương trình"* | STT · Nội dung · Số tiền tạm ứng · Người nhận · STK–Ngân hàng |
| **ĐNTT** | Người xin thanh toán, SĐT, Chương trình, Lý do | STT · Chứng từ (Số, Ngày) · Nội dung · Thực tế phát sinh · Người nhận–STK |
| **ĐNHTU** | Như ĐNTT | STT · Chứng từ · Nội dung · Thực tế · Đã tạm ứng · Thanh toán bổ sung · Thu hoàn tạm ứng · Người nhận–STK |

App tự điền đầu phiếu, tự tính tổng, bổ sung/thu hoàn, **bằng chữ** (dùng "ngàn" như mẫu), ngày ký (không ghi cứng năm). Xuất **PDF và Excel đúng bố cục mẫu**, luôn có logo (Q7). Logo lấy từ 2 ảnh trong mẫu, lưu ở `public/brand/`.

## 8. Dữ liệu cần lưu (Prisma)

Tiền dùng `Decimal(18,2)` và **làm tròn tới đồng** khi lưu (tránh số kiểu 135.999.999,99999997 do `=2160000/1.08`).

```prisma
// User.role thêm "ACCOUNTANT".
// Project thêm: icApproverId String?, acApproverId String?

model FinanceSheet {                  // 1 "bảng tài chính" = 1 phiên bản, như 1 file AC
  id             String   @id @default(cuid())
  projectId      String
  version        Int
  icStatus       String   @default("DRAFT")  // DRAFT | SUBMITTED | APPROVED | REJECTED
  acStatus       String   @default("NONE")   // NONE | DRAFT | SUBMITTED | APPROVED | REJECTED
  superseded     Boolean  @default(false)
  // Thông tin chung (Q12) — trống thì tự ẩn khi xuất file
  clientName     String?
  programName    String?
  headcount      String?              // "240 khách"
  location       String?
  eventStart     DateTime?
  eventEnd       DateTime?
  sellVatRate    Decimal  @default(0.08)
  // tổng lưu sẵn
  quoteTotalGross   Decimal @default(0)  // báo giá gồm VAT
  acceptedTotalGross Decimal @default(0) // nghiệm thu gồm VAT
  icCostTotal    Decimal  @default(0)
  acCostTotal    Decimal  @default(0)
  sourceFileId   String?
  icSubmittedAt  DateTime?
  icApprovedById String?
  icApprovedAt   DateTime?
  acSubmittedAt  DateTime?
  acApprovedById String?
  acApprovedAt   DateTime?
  createdById    String
  sections       FinanceSection[]
  issues         FinanceIssue[]
  @@unique([projectId, version])
}

model FinanceSection { id String @id @default(cuid()) sheetId String order Int name String lines SellLine[] }

model SellLine {                      // 1 hạng mục bán (khối BÁO GIÁ + NGHIỆM THU)
  id               String  @id @default(cuid())
  sectionId        String
  order            Int
  stt              String?
  name             String
  description      String?
  unit             String?
  quantity         Decimal?
  unitPrice        Decimal?           // null = "-" (không tính tiền riêng)
  note             String?
  acceptedQuantity Decimal?           // NGHIỆM THU
  acceptedUnitPrice Decimal?
  acceptedNote     String?
  costs            CostLine[]
}

model CostLine {                      // 1 dòng chi phí (khối IC + AC), nhiều dòng / 1 hạng mục bán
  id            String  @id @default(cuid())
  sellLineId    String
  order         Int
  description   String?               // "Chi phí sản xuất tượng"
  unit          String?
  // IC
  icQuantity    Decimal?
  icUnitPrice   Decimal?
  icVatRate     Decimal?              // null = không có hoá đơn (phải xác nhận)
  icSupplierId  String?
  // AC
  acQuantity    Decimal?
  acUnitPrice   Decimal?
  acVatRate     Decimal?
  acSupplierId  String?
  acDetailNote  String?               // giải thích chênh lệch
  addedInAc     Boolean @default(false) // dòng phát sinh, không có trong IC
}

model Supplier {                      // danh bạ NCC (Q4)
  id            String  @id @default(cuid())
  name          String  @unique       // "CTY TNHH MT VA CN ARTECH"
  shortName     String?               // "ARTECH", "HUY" — tên gọi trong cột SUP
  kind          String  @default("COMPANY") // COMPANY | PERSON
  taxCode       String?
  phone         String?
  bankAccount   String?
  bankName      String?
  accountHolder String?
}

model PaymentRequest {                // ĐNTU | ĐNTT | ĐNHTU
  id            String   @id @default(cuid())
  projectId     String
  sheetId       String               // bảng tài chính dùng làm gốc
  kind          String               // ADVANCE | PAYMENT | SETTLEMENT
  code          String   @unique     // TU-2026-0001…
  requesterId   String
  requesterPhone String?
  reason        String?
  repayDueAt    DateTime?            // ĐNTU
  status        String   @default("DRAFT") // DRAFT | SUBMITTED | APPROVED | REJECTED | PAID | CANCELLED
  total         Decimal  @default(0)
  approvedById  String?
  approvedAt    DateTime?
  paidById      String?
  paidAt        DateTime?
  lines         PaymentRequestLine[]
}

model PaymentRequestLine {
  id             String  @id @default(cuid())
  requestId      String
  order          Int
  costLineId     String?
  supplierId     String?
  advanceLineId  String?             // ĐNHTU: dòng tạm ứng được quyết toán
  content        String
  voucherNo      String?
  voucherDate    DateTime?
  amount         Decimal             // ĐNTU: số tạm ứng · ĐNTT/ĐNHTU: thực tế
  advancedAmount Decimal @default(0)
  extraPay       Decimal @default(0) // tự tính
  refund         Decimal @default(0) // tự tính
  payeeName      String              // chụp lại lúc lập phiếu
  payeeBank      String?
}

model SupplierDocument {              // 1 file chứng từ của 1 NCC trong 1 dự án (Q13) — không phân loại
  id          String   @id @default(cuid())
  projectId   String
  supplierId  String
  fileId      String   @unique       // ProjectFile (tên file, loại, dung lượng, người tải, driveFileId lấy từ đây)
  createdAt   DateTime @default(now())
  @@index([projectId, supplierId])
}
// Trạng thái "Có chứng từ · N file" / "Chưa có chứng từ" = đếm SupplierDocument theo (projectId, supplierId).

model ApprovalEvent   { id String @id @default(cuid()) targetType String targetId String action String actorId String note String? createdAt DateTime @default(now()) }
model FinanceIssue    { /* ruleCode, severity, source CODE|AI, status, ackReason, sellLineId?, costLineId? */ }
```

- IC và AC nằm **trên cùng các dòng**, giống Excel: duyệt IC thì khoá các cột `ic*`, sau đó mới mở các cột `ac*` và Nghiệm thu.
- Sửa IC sau khi đã duyệt → tạo **phiên bản mới**, bản cũ đánh dấu `superseded`.
- **Doanh thu dự án** (`Project.revenue`) = `quoteTotalGross` khi IC duyệt, rồi = `acceptedTotalGross` khi AC duyệt (Q9).

## 9. Luật kiểm lỗi

Mỗi luật có ví dụ thật từ file mẫu nếu có.

### 9.1 Bảng tài chính (IC/AC)
| Mã | Luật | Ví dụ từ file mẫu |
|---|---|---|
| R01–R05 | Tính toán thành tiền, VAT, tổng, lợi nhuận, margin | — |
| R06 | Tiền lẻ phần thập phân → làm tròn tới đồng | Jabil: `2160000/1.08` ra 135.999.999,99999997; tạm ứng ARTECH 52.499.999,88 |
| F01 | Công thức có vùng không phủ hết các dòng | Vietjet: `SUMIF(P9:P13)`; Jabil: `SUMIF($Q$8:$Q$15…)` lấy nhầm cột Ghi chú |
| F04 | Ô lỗi `#VALUE!`, `#REF!` | Jabil sheet Logistic: cột Minh chứng toàn `#VALUE!` |
| C01 | Thiếu thông tin chung → chỉ nhắc trong app, khi xuất file mục trống tự ẩn (Q12) | Vietjet: thiếu Số lượng, Địa điểm |
| C03 | Dòng chi phí chưa có NCC | Vietjet: cả cột SUP trống |
| C07 | STT nhảy cóc / trùng | Jabil: STT 1 → 3 (không có 2) |
| C08 | Tên NCC gọi tắt không có trong danh bạ → hỏi để thêm | Jabil: "HUY", "A.QUANG" |
| B02 | Margin dòng bất thường | Vietjet: Sticker 94% |
| B04 | Dòng không VAT trong khi dòng khác có → xác nhận | Vietjet: Biên đạo |
| A01 | AI: ghi chú mâu thuẫn số | Vietjet: Đạo cụ thiếu 300.000 |
| AC03 | Chi phí thực tế ở dòng IC = 0 (phát sinh) → bắt ghi lý do | Jabil: Đổi mặt phiên bản 3D: IC 0 → AC 100.000 |
| AC02 | Dòng AC vượt IC | Jabil: Vận chuyển IC 1.000.000 → AC 3.690.000 (+269%) |
| AC04 | Dòng IC không có chi phí thực tế | — |
| AC06 | Lợi nhuận AC thấp hơn IC | Jabil: 23,6% → 21,5% (−2.790.000) |
| AC08 | (Tuỳ chọn, giai đoạn AI) AI đọc file chứng từ của NCC, so tổng với AC theo NCC | Jabil: ARTECH 105.099.999,76 vs minh chứng 105.100.000 (lệch do làm tròn) |
| AC09 | Nghiệm thu khác Báo giá → hiện chênh lệch doanh thu | Jabil: bằng nhau |
| AC07 | AI giải thích chênh lệch, đối chiếu cảnh báo cũ của IC | — |

*Các luật theo ngưỡng (B01 margin tối thiểu, AC02/AC06 theo %) tạm thời chỉ hiện thông tin (Q10).*

### 9.2 Đề nghị tạm ứng (ĐNTU)
| Mã | Luật | Mức |
|---|---|---|
| TU01 | IC chưa duyệt → chưa lập được | Chặn |
| TU02 | AC đã duyệt → hết lập ĐNTU (Q6) | Chặn |
| TU03 | Tổng tạm ứng của NCC/dòng vượt ngân sách IC còn lại | Cảnh báo |
| TU04 | Thiếu ngày hoàn tạm ứng | Lỗi |
| TU05 | Người nhận thiếu STK | Lỗi |
| TU06 | Người lập đang có tạm ứng quá hạn chưa hoàn | Cảnh báo (nhắc cam kết bonus) |

### 9.3 Thanh toán (ĐNTT) & Hoàn tạm ứng (ĐNHTU)
| Mã | Luật | Ví dụ |
|---|---|---|
| TT01 | AC chưa duyệt → chưa lập được | — |
| TT02 | Đã ứng + đã thanh toán + phiếu này > chi phí thực tế của NCC/dòng | — |
| TT03 | Phiếu thiếu "Chứng từ số/ngày" (cột có sẵn trên mẫu ĐNTT/ĐNHTU) | — |
| TT04 | Trùng số chứng từ của cùng NCC | — |
| TT06 | NCC chưa có chứng từ nào → nhắc khi lập phiếu (không chặn) | Jabil: A.QUANG |
| HU01 | Bổ sung = max(thực tế − đã ứng, 0); thu hoàn = max(đã ứng − thực tế, 0), **tự tính** | Mẫu ĐNHTU: dòng 1 thực tế 28.728.000, đã ứng 26.000.000 → phải bổ sung 2.728.000, nhưng mẫu để trống nên tổng = 0 |
| HU02 | Mọi khoản tạm ứng phải được quyết toán | Jabil/Logistic: ứng 1.000.000, thực tế 3.690.000 → bổ sung 2.690.000 |
| HU03 | "Bằng chữ" tự sinh, khớp số | Mẫu ĐNHTU ra "Không đồng. đồng ./." |
| HU04 | Còn tạm ứng chưa hoàn → không đóng được dự án | — |

## 10. Thông báo

**Email duyệt (Q17)** — áp dụng cho IC, sau này cả AC và các phiếu đề nghị:
- Bấm "Gửi duyệt" mở hộp gửi: **Gửi tới** = người duyệt của dự án (cố định); **CC** = chọn thêm người trong app (gợi ý sẵn Account phụ trách, chủ dự án; nhớ danh sách CC lần trước của dự án); kèm **lời nhắn** tuỳ chọn.
- Người bấm đã **"Kết nối Google"** (trang Tài khoản của tôi; một lần cho phép gồm `gmail.send` — chỉ gửi, không đọc thư — và quyền tạo nhóm Google Chat; phải trùng email đăng nhập) thì email đi **từ hộp thư của chính họ**. Chưa kết nối hoặc gửi lỗi thì gửi từ hộp thư chung của app (SMTP), **Reply-To là người bấm**.
- Nội dung: dự án, khách hàng, phiên bản IC, tổng giá vốn, số cảnh báo chưa xử lý, lời nhắn, nút **"Mở IC để duyệt"** (vào app mới duyệt được, giống email nghỉ phép — không duyệt bằng một cú bấm trong email).
- Giá bán, lợi nhuận, margin chỉ có trong email khi **mọi người nhận** đều có quyền xem số liệu tài chính; có người không có quyền thì email bỏ các số đó.
- Duyệt / từ chối → email trả lời **trong cùng luồng** tới người gửi + danh sách CC (từ chối kèm lý do).
- Chuông thông báo trong app vẫn giữ; **không gửi Google Chat** cho luồng duyệt.
- **Nhóm Google Chat theo dự án:** tab "Google Chat" của dự án có nút **Tạo nhóm Google Chat** (tên trùng tên dự án, thêm sẵn thành viên dự án; người mới vào dự án tự được thêm). App chỉ tạo nhóm và thêm người, không đọc tin nhắn. Đăng tin thông báo vào nhóm (bot hay tên người bấm) — chưa chốt.

- Gửi duyệt IC/AC/phiếu → người duyệt của dự án (chuông + Google Chat).
- Duyệt xong → Kế toán (chờ chi) + người lập. Từ chối → người lập kèm lý do.
- Tạm ứng sắp đến hạn hoàn (trước 3 ngày) / quá hạn → người lập; quá hạn → cả người duyệt. Dùng cron có sẵn (`app/api/cron/daily-digest`).

## 11. Các bước triển khai

| Giai đoạn | Nội dung |
|---|---|
| 1 ✅ | Vai trò Kế toán, người duyệt theo dự án, danh bạ NCC (có tên gọi tắt), logo `public/brand/` — *đã làm 25/10/2026, đã commit trên branch finance-phase-1* |
| 1b ✅ | Kết nối Google Drive (tài khoản noreply), tạo thư mục theo dự án, share quyền tự động; chuyển **tài liệu dự án và file task** sang Drive (Q21), gồm script chuyển file cũ và xoá cột `data`. Làm trước giai đoạn 6 để chứng từ NCC dùng chung cách lưu. — *đã làm 28/10/2026 trên branch drive-storage: kết nối Drive ở Cài đặt → Lưu trữ, file mới tự lên Drive, tải thẳng tới 100 MB, biên bản họp thành Google Doc, share tự động, cron 2h sáng, nút chuyển file cũ. Chưa xoá cột `data` (bước 5 của mục chuyển file cũ).* |
| 2 | Bảng tài chính: khối Báo giá + IC, sửa tay, tính tổng, ẩn theo vai trò, gửi/duyệt IC, xuất Excel/PDF có logo — *2a (nhập tay, tính tổng, ẩn giá bán với USER) đã làm trên branch finance-phase-2a; 2b (gửi/duyệt/từ chối/rút lại/phiên bản mới, email To–CC–Reply-To cùng luồng, thông báo trong app) đã làm trên branch finance-phase-2b; còn 2c xuất file* |
| 3 | Nhập từ Excel (đọc 4 khối theo tiêu đề cột) + kiểm lỗi bằng code — *đã làm trên branch finance-phase-3 (nhập Báo giá + IC; khối Nghiệm thu/AC mới được nhận diện, sẽ nhập khi làm AC)* |
| 4 | Báo giá xuất cho khách |
| 5 | ĐNTU: lập theo NCC/dòng IC (số tiền do người lập nhập), duyệt, Kế toán chi, in mẫu ĐNTU-CS.2024, nhắc hạn |
| 6 | AC: Nghiệm thu + chi phí thực tế + chứng từ theo NCC + xem file trong app (Q14), so IC, duyệt, cập nhật doanh thu |
| 7 | ĐNHTU + ĐNTT: lập từ AC, tự tính bổ sung/thu hoàn, in mẫu |
| 8 | AI: rà IC/AC, (tuỳ chọn) đọc file chứng từ của NCC, giải thích chênh lệch |
| 9 | Mục "Đề nghị chi" ở thanh bên, Doanh số thêm lợi nhuận |

Test mỗi giai đoạn dùng số liệu file Jabil, Vietjet và 3 phiếu mẫu làm chuẩn.

## 12. Rủi ro
| Rủi ro | Cách xử lý |
|---|---|
| Lộ giá bán/lợi nhuận cho USER | Lọc ở server và trong file xuất |
| Doanh thu cũ đang nhập tay có thể là trước VAT; từ nay tính sau VAT | Khi bật tính năng, liệt kê các dự án chưa có IC để Account kiểm tra lại doanh thu; ghi rõ "sau VAT" trên trang Doanh số và KPI |
| Sửa số sau khi duyệt | Khoá IC/AC đã duyệt; phiếu đã chi chỉ huỷ bằng phiếu điều chỉnh |
| STK sai → chuyển nhầm | Chụp STK vào phiếu; cảnh báo khi STK khác lần trước của cùng NCC |
| Gửi hoá đơn cho AI | Gemini gói trả phí, công tắc bật/tắt trong Cài đặt |

## 13. Còn mở
- Ngưỡng margin / % AC vượt IC: chưa cần (Q10), bổ sung sau.
- Doanh thu từ PO (luồng `import-po`): PO Jabil ghi "giá bao gồm VAT" nên nhiều khả năng đã là số sau VAT, khớp với Q9. Sẽ kiểm tra lại bằng PO thật khi làm giai đoạn 6.
