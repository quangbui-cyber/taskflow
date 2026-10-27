# Kế hoạch triển khai: Giao diện mới · IC trước báo giá · AI nhập Excel

> Tài liệu giao việc cho các nhóm code. Mỗi hạng mục ghi rõ **file cần sửa**, **hình tham chiếu** trong Claude và **tiêu chí nghiệm thu**.
> Nhánh nền: `preview/costflow-ui-refactor` (đã gộp PR #55 — giao diện điều hướng mới).
> Ngày lập: 27/10/2026.

---

## 0. Cách xem hình tham chiếu (Claude)

Toàn bộ bản vẽ nằm trong **một trang thiết kế Claude**:

**https://claude.ai/artifact/J7V7hmT3r3t6xTETgToB8d**

- Trang đang để **riêng tư**. Chủ sản phẩm cần bấm **Share** (góc trên trang) và cấp quyền xem cho người nhận, nếu không link sẽ không mở được.
- Mở link sẽ thấy một **canvas** gồm nhiều khung (artboard). Tên khung hiện ở dải phía trên mỗi khung. Kéo/thu phóng để di chuyển; bấm đúp vào khung để xem riêng.
- Muốn lấy ảnh: dùng mục **Share → Export** của trang (nếu có) hoặc chụp màn hình khung cần dùng.
- Các khung chia theo hàng, mỗi hàng có tiêu đề lớn ở trên.

### Bảng khung tham chiếu dùng trong tài liệu này

| Mã ref | Tên khung trên canvas | Dùng cho |
|---|---|---|
| R1 | `B1 - Thanh trắng tối giản` | Thanh icon bên trái (đã làm trong PR #55) |
| R2 | `myCreative - Trang chủ Bước 1 (dữ liệu sẵn có)` | Trang chủ `/` (đã làm trong PR #55) |
| R3 | `Sitemap myCreative` | Cấu trúc 5 khu vực + tiện ích |
| R4 | `Công việc › Tài liệu` | Khuôn trang con + trang Tài liệu |
| R5 | `Dự án › Danh sách theo Team` | Trang `/projects` (đã làm) |
| R6 | `Hiệu quả › Hiệu suất` | Khuôn trang con nhóm Hiệu quả |
| R7 | `Đội ngũ › Góc cảm ơn` | Khuôn trang con nhóm Đội ngũ |
| R8 | `CostFlow - Luồng nghiệp vụ` | Thứ tự 12 bước mới (IC trước báo giá) |
| R9 | `Luồng A - Lập và duyệt IC` | Luồng IC → báo giá → duyệt, theo vai trò |
| R10 | `Luồng B - Chi tiền, Actual Cost, quyết toán` | Luồng chi tiền sau khi IC có hiệu lực |
| R11 | `CostFlow - Kiến trúc kỹ thuật` | 4 tầng code CostFlow |
| R12 | `Nhập IC từ Excel bằng AI (dữ liệu file IC_Pickerball)` | Màn hình AI nhập Excel |

> Các khung `Phương án A/B/C`, `B2`, `B3`, `Trang chủ - Bảng tin`, `Trang chủ vui`, `My Creasia A/B` là phương án đã cân nhắc, **không** dùng để code trong đợt này.

---

## 1. Quyết định nghiệp vụ đã chốt

| # | Quyết định | Ghi chú |
|---|---|---|
| D1 | **Lập IC trước, báo giá sau.** Báo giá được lập ngay khi IC **còn nháp**. | Hiện code chặn (xem WP3). |
| D2 | **Chỉ chi tiền khi IC có hiệu lực** = **Quản lý duyệt** (giữ như hiện tại). | Đã đúng trong code: `lib/costflow/service.ts` (~dòng 732) và `lib/costflow/paymentPolicy.ts` (dòng 43). Không đổi. |
| D3 | **Khi Quản lý duyệt IC, phải thông báo ngay cho cả Kế toán và CEO.** | Hiện chỉ báo Kế toán (xem WP2). |
| D4 | Báo giá có nhiều dạng: **trọn gói**, **từng hạng mục**, hoặc **trộn theo nhóm**. | Code đã có `pricingMode: "PACKAGE" \| "DETAIL"` theo nhóm (`lib/costflow/types.ts`). Cần thêm trọn gói toàn báo giá (WP4). |
| D5 | **AI đọc file Excel báo giá + IC của công ty**, tự nhập thành nháp, kiểm tra lỗi và đề xuất cách sửa. Người dùng xác nhận trước khi lưu. | WP5. AI **không** tự gửi duyệt. |

---

## 2. Hiện trạng (đã làm trong PR #55)

PR https://github.com/quangbui-cyber/taskflow/pull/55 đã gộp vào `preview/costflow-ui-refactor`:

- `lib/navigation.ts` — cấu hình 5 khu vực (Trang chủ, Công việc, Dự án, Hiệu quả, Đội ngũ) và các mục con.
- `components/Sidebar.tsx` — thanh icon 84px (ref **R1**), chuông thông báo, Cài đặt (Admin), avatar, đăng xuất; menu di động nhóm theo khu vực.
- `components/HubTabs.tsx` — hàng tab mục con ở đầu trang; đã gắn vào `app/{meetings,kpi,team,documents,leave,recognition,revenue,suppliers}/page.tsx` và `components/ModuleShell.tsx` (cho `/workflow`, `/suppliers`).
- `app/page.tsx` — trang chủ mới (ref **R2**).
- `app/tasks/page.tsx` — trang Công việc cũ chuyển sang `/tasks`; `/?view=&sort=` tự chuyển hướng.
- `app/projects/page.tsx` — danh sách dự án theo team (ref **R5**).
- `tests/costflow-supplier-ui.test.mjs` — kiểm tra link `/suppliers` ở `lib/navigation.ts`.

---

## 3. Hạng mục công việc

Thứ tự đề xuất: **WP2 → WP3 → WP4 → WP5 → WP1**. WP2 nhỏ, làm ngay. WP3–WP4 là nền cho WP5.

Kích thước: **S** nhỏ (≤1 ngày) · **M** vừa · **L** lớn.

---

### WP1 — Hoàn thiện giao diện điều hướng (M)

**Hình tham chiếu:** R1, R3, R4, R6, R7.

**Việc cần làm**

1. **Gộp tiêu đề trang vào khuôn trang con** (ref R4/R6/R7): mỗi trang con có 1 khối đầu trang trắng gồm dòng nhỏ tên khu vực → tiêu đề trang → nút chính bên phải → hàng tab mục con (gạch chân xanh).
   - Sửa `components/HubTabs.tsx`: nhận thêm `title`, `actions?: ReactNode`; render khối đầu trang đầy đủ thay vì chỉ hàng tab.
   - Sửa các trang đang gọi `<HubTabs …/>`: xoá tiêu đề `h1.tf-page-title` riêng của trang, truyền `title`/`actions` vào `HubTabs`.
     Files: `app/meetings/page.tsx`, `app/kpi/page.tsx`, `app/team/page.tsx`, `app/documents/page.tsx`, `app/leave/page.tsx` (3 chỗ), `app/recognition/page.tsx`, `app/revenue/page.tsx`, `app/suppliers/page.tsx`, `app/tasks/page.tsx`, `app/projects/page.tsx`, `components/ModuleShell.tsx`.
   - Bộ lọc phụ trong trang dùng dạng nút bo tròn nhỏ (ref R5, R7), không dùng thêm hàng tab thứ hai.
2. **Bỏ truy vấn thừa:** `Sidebar` không còn dùng prop `projects`. Xoá truy vấn `sidebarProjects` ở các trang trên và trong `components/ModuleShell.tsx`, rồi xoá prop `projects` khỏi `components/Sidebar.tsx`.
3. **Trang Tài liệu** theo R4: cột trái danh sách bộ hồ sơ, cột phải lưới file có nhãn loại (DOCX/PDF/XLSX/PPT/Link), ô tìm kiếm, nút Tải lên/Thêm link, ô kéo thả.
   Files: `app/documents/page.tsx`, `components/DocumentSets.tsx`.
4. **Kiểm tra trên điện thoại (390px)**: thanh icon ẩn, menu ☰ nhóm theo khu vực; hàng tab cuộn ngang được.

**Nghiệm thu**
- Mọi trang con có cùng khuôn đầu trang như R4/R6/R7.
- Không trang nào còn truy vấn danh sách dự án chỉ để vẽ sidebar.
- `npx tsc --noEmit`, `npx eslint <files>`, `npm test` không phát sinh lỗi mới.

---

### WP2 — Thông báo Kế toán và CEO khi Quản lý duyệt IC (S)

**Hình tham chiếu:** R9 (làn Quản lý → "IC có hiệu lực").

**Hiện trạng:** `lib/costflow/service.ts`, khoảng dòng 1748–1786:
- Dòng ~1752: `if (action === "APPROVE" && role === "MANAGER") data.revisions.forEach(r => { r.effective = r.id === revision.id; });` — IC có hiệu lực.
- Dòng ~1757: `nextAssignee` = người ở bước kế tiếp (Kế toán).
- Dòng ~1786: `recordApprovalEvent(... recipients: ceoRecipients.length ? ceoRecipients : nextAssignee ? [nextAssignee] : [])` → **chỉ Kế toán nhận thông báo**.

**Việc cần làm**
1. Khi `request.kind === "IC" && role === "MANAGER" && action === "APPROVE"`: recipients = `[Kế toán, CEO, người lập IC]` (lấy từ `steps.find(s => s.role === "ACCOUNTANT")`, `steps.find(s => s.role === "CEO")`, `request.creatorId`), bỏ trùng.
2. Nội dung thông báo cho CEO ghi rõ: *"IC-R{n} đã có hiệu lực (Quản lý duyệt). Dự án có thể bắt đầu lập hồ sơ chi."* — xem cách dựng nội dung ở `lib/workflow/notifications.ts` / `lib/workflow/notificationDelivery.ts`.
3. Không đổi thứ tự bước duyệt; CEO vẫn quyết định ở bước của mình.

**Test:** thêm case vào `tests/ic-effectiveness.test.ts` (unit) và `tests/ic-effectiveness.integration.test.ts` (DB): Quản lý duyệt → có approval event với đủ 3 recipients.

**Nghiệm thu:** Quản lý bấm Duyệt IC → Kế toán và CEO đều thấy thông báo trong chuông (và push/email nếu đã bật).

---

### WP3 — Lập IC độc lập, trước báo giá (L)

**Hình tham chiếu:** R8 (bước 2), R9 (làn Account: "AI đọc → nháp IC" → "Kiểm tra / sửa IC" → "Gửi IC").

**Hiện trạng (code đang chặn)**
- `lib/costflow/pairedService.ts` dòng ~114: `if (!source) throw new Error("Chọn báo giá nguồn để lập IC.")` — mode `ic` bắt buộc có báo giá nguồn.
- `lib/costflow/pairedService.ts` dòng ~102: `"Lưu Báo giá trước khi dùng lựa chọn Chỉ lưu IC."` — bảng song song không cho lưu IC khi chưa có báo giá.
- `lib/costflow/workspaceFlow.ts`: `WORKSPACE_CAPABILITIES.ic.editHierarchy = false` — IC không được thêm/xoá hạng mục.

**Việc cần làm**
1. **Chế độ mới `ic-first`** trong `lib/costflow/workspaceFlow.ts`:
   ```ts
   "ic-first": { editSales: false, editBuying: true, editHierarchy: true,
                 configureQuotationTotals: false, manageIcEvidence: true,
                 previewCustomer: false, finalizeQuotation: false }
   ```
   Cập nhật kiểu `CostFlowWorkspaceMode`, `workspaceSaveLabel` ("Lưu nháp IC").
2. **`lib/costflow/pairedService.ts`**: cho phép `mode === "ic-first"` lưu khi **không có** `sourceQuotationId` và **không có** nháp báo giá trước; tự do thêm/xoá/sắp xếp hạng mục; cột bán (`sell`) để trống. Giữ nguyên toàn bộ kiểm tra quyền, phiên bản, minh chứng, `assertCalculatedValues`.
3. **Route mới** `app/projects/[id]/costflow/ic/new/page.tsx` dùng `components/CostFlowWorksheet.tsx` với `mode="ic-first"`.
4. **`components/PairedQuotationIcEditor.tsx`**: ở mode `ic-first` hiển thị cột IC (mua) trước, ẩn cột bán; có nút "Tạo báo giá từ IC" (WP4).
5. **`components/QuotationPanel.tsx` / `components/InternalCostPanel.tsx`**: nút chính đổi thành **"Lập IC"** (đi tới route mới). Nút "Tạo báo giá" chuyển thành bước sau trong cùng nháp.
6. **Gửi duyệt IC không cần báo giá**: rà luồng submit IC trong `lib/costflow/service.ts` và `lib/costflow/budgetRevisions.ts` — bỏ mọi điều kiện bắt buộc có báo giá nguồn; vẫn bắt buộc đủ giá vốn, VAT, số ngày > 0, minh chứng hoặc lý do theo từng dòng (giữ quy tắc hiện tại).
7. Giữ tương thích: luồng cũ "báo giá → IC" vẫn chạy cho dữ liệu đã có.

**Test**
- Unit: mở rộng `tests/workspace-flow.test.ts` cho mode `ic-first`.
- Integration: `tests/paired.integration.test.ts` — tạo IC không có báo giá → lưu nháp → gửi duyệt → Quản lý duyệt → IC có hiệu lực → lập được hồ sơ chi.

**Nghiệm thu:** Dự án mới chưa có báo giá vẫn lập, lưu, gửi duyệt IC được; sau khi Quản lý duyệt thì lập hồ sơ chi được.

---

### WP4 — Tạo báo giá từ IC (trọn gói / từng hạng mục / trộn) (M)

**Hình tham chiếu:** R8 (bước 3), R9 (nút xanh dương "Lập báo giá từ IC", mũi tên "Lập báo giá ngay khi IC còn nháp"), R12 (lỗi số 4 "Giá bán từng dòng chưa rõ" với 2 nút "Báo giá trọn gói" / "Chia giá bán theo % lợi nhuận").

**Việc cần làm**
1. **Module mới** `lib/costflow/quotationFromIc.ts` (hàm thuần, có unit test):
   - Đầu vào: các dòng IC (`PairedRow[]`), cấu hình giá bán:
     - `mode: "LINE_MARKUP"` — giá bán = giá vốn chưa VAT × (1 + %), % theo dòng / nhóm / cả bảng;
     - `mode: "PACKAGE_TOTAL"` — nhập tổng bán trọn gói (ví dụ 82.000.000 đ gồm VAT); các dòng chỉ hiện nội dung, không hiện giá;
     - trộn: nhóm nào `pricingMode = "PACKAGE"` thì bán theo gói nhóm, nhóm khác theo dòng.
   - Làm tròn giá bán theo bước chọn được (1.000 đ / 10.000 đ), dùng quy tắc làm tròn của `lib/costflow/money.ts`.
   - Đầu ra: cột `sell` cho từng dòng + `totalLines` cho báo giá.
2. **Trọn gói toàn báo giá**: thêm cờ cấp báo giá (ví dụ `quotation.pricingMode = "PACKAGE_TOTAL"` trong JSON workspace) hoặc dùng một nhóm gốc `PACKAGE`. Chọn cách không cần migration (dữ liệu CostFlow lưu JSON trong `CostFlowWorkspace`).
3. **UI**: trong `components/PairedQuotationIcEditor.tsx` thêm drawer "Tạo báo giá từ IC" (cùng kiểu `components/QuotationSettingsDrawer.tsx`) gồm: chọn kiểu giá (trọn gói / theo % / trộn), ô % lợi nhuận, bước làm tròn, xem trước tổng bán – tổng vốn – lợi nhuận – % lợi nhuận.
4. Báo giá lập được khi IC **còn nháp** (D1). Báo giá **không** làm IC thay đổi; đổi IC sau đó thì hiện thông báo "IC đã đổi, cập nhật giá bán?" (dùng cơ chế "Nguồn đã có bản mới" hiện có).
5. Bản in cho khách: giữ nguyên allowlist phía bán (`lib/costflow/quotationProjection.ts`); trọn gói thì chỉ in tổng.

**Test:** `tests/quotation-totals.test.ts` + file mới `tests/quotation-from-ic.test.ts`. Ca mẫu từ file IC_Pickerball: tổng vốn chưa VAT 52.959.348 đ, bán trọn gói 82.000.000 đ gồm VAT 8% → bán chưa VAT 75.925.926 đ, lợi nhuận 22.966.578 đ (30,2%).

---

### WP5 — AI nhập file Excel báo giá + IC, kiểm tra và đề xuất sửa (L)

**Hình tham chiếu:** **R12** (màn hình chính), R9 (khối tím nét đứt "AI đọc → nháp IC").

**Bối cảnh**
- Bản preview chỉ nhận Excel **mẫu v4**; file thật của công ty (ví dụ `IC_Pickerball.xlsx`) bị **từ chối** vì có liên kết sang file khác: `lib/costflow/excelIntakeSecurity.ts` dòng 16 (`FORBIDDEN_ENTRY` gồm `externalLinks/`) và dòng 115/121.
- Bộ "Nhập Excel" của bản đang chạy (`lib/financeImport.ts` trên `main`) dò tiêu đề cột nhưng **đọc sai** file này (gộp 1 nhóm, doanh thu 24,5 triệu, lãi −116%). → Cần AI hiểu bố cục tự do.
- App đã có Gemini cho biên bản họp: `lib/meetingRecapAi.ts` (gọi `https://generativelanguage.googleapis.com/v1beta/models`, đọc `GEMINI_API_KEY`), giới hạn chi phí ở `lib/meetingRecapLimits.ts`, cờ tính năng ở `lib/features.ts`.

**Luồng xử lý**
```
Tải file .xlsx
 → (1) Kiểm tra an toàn: chặn macro/OLE/DDE như cũ; liên kết ngoài KHÔNG chặn cả file,
       chỉ đánh dấu ô dùng giá trị đã lưu (cached value)
 → (2) Trích lưới ô: giá trị + công thức + ô gộp + định dạng số, theo từng sheet (code, không AI)
 → (3) Gemini: nhận lưới ô (đã che thông tin tài khoản ngân hàng) → trả JSON theo schema:
       thông tin chung, nhóm, dòng (cha/con), cột bán, cột mua, VAT, NCC, lịch thanh toán, kiểu giá bán
 → (4) Kiểm tra bằng code (không tin số của AI): tính lại toàn bộ tiền bằng lib/costflow/money.ts,
       chạy bộ luật kiểm tra (mục 5.4), so tổng với ô tổng trong file
 → (5) Phiên xem trước (dùng lại ExcelIntakePreviewSession trong lib/costflow/excelIntakeService.ts)
 → (6) Người dùng chọn cách sửa từng lỗi → Lưu nháp IC (+ nháp báo giá nếu chọn)
```

**5.1 File cần tạo**
| File | Nội dung |
|---|---|
| `lib/costflow/aiIntake/grid.ts` | Đọc workbook bằng ExcelJS, xuất lưới ô gọn (tọa độ, giá trị, công thức, ô gộp, sheet ẩn). Bỏ ảnh. |
| `lib/costflow/aiIntake/redact.ts` | Che số tài khoản/STK, CMND/CCCD, số điện thoại trước khi gửi AI. |
| `lib/costflow/aiIntake/gemini.ts` | Gọi Gemini theo mẫu `lib/meetingRecapAi.ts` (timeout, lỗi riêng `AiIntakeServiceError`, `responseMimeType: "application/json"`, schema). |
| `lib/costflow/aiIntake/schema.ts` | Kiểu dữ liệu + hàm kiểm tra JSON trả về (repo không dùng zod; viết kiểm tra thủ công như `lib/costflow/excelIntake.ts`). |
| `lib/costflow/aiIntake/checks.ts` | Bộ luật kiểm tra (mục 5.4), mỗi luật có mã, mức độ, ô liên quan, đề xuất sửa, các nút lựa chọn. |
| `lib/costflow/aiIntake/limits.ts` | Hạn mức lượt/ngày, dung lượng file; theo mẫu `lib/meetingRecapLimits.ts`. |
| `app/api/projects/[id]/costflow/excel-intake/ai-preview/route.ts` | Nhận file, kiểm tra quyền (Account/Admin + thành viên dự án, như route `preview` hiện có), chạy (1)–(5), trả phiên xem trước. `private, no-store`. |
| `components/costflow/AiIntakeDialog.tsx` | Giao diện theo **R12**: thẻ tóm tắt, bảng xem trước tô đỏ/vàng, cột "AI kiểm tra" có nút chọn cách sửa, thanh lưu cuối trang. |

**5.2 File cần sửa**
- `lib/costflow/excelIntakeSecurity.ts`: tách `externalLinks/` khỏi `FORBIDDEN_ENTRY` cho luồng AI; vẫn chặn `vbaProject.bin`, `activeX/`, `embeddings/`, `oleObject`, DDE, file mã hoá.
- `lib/costflow/excelIntakeService.ts`: thêm loại phiên `AI_NEW_DRAFT`; dùng lại cơ chế xác nhận (Serializable, idempotency, fingerprint).
- `lib/features.ts`: `costflowAiIntakeEnabled()` = có `GEMINI_API_KEY` **và** `COSTFLOW_AI_INTAKE_ENABLED=1`.
- `components/QuotationPanel.tsx`: thêm nút **"Nhập Excel bằng AI"** cạnh nút Excel v4 hiện có (dòng ~158–160).
- `.env.example`: thêm `COSTFLOW_AI_INTAKE_ENABLED`, `COSTFLOW_AI_DAILY_FILES`, `COSTFLOW_AI_MODEL`.

**5.3 Giao diện (R12)**
- Đầu trang: tên file, sheet, trạng thái "AI đã đọc xong", nút "Tải file khác".
- 6 thẻ tóm tắt: số nhóm, số dòng chi phí, số NCC (kèm "chưa có trong danh bạ"), giá bán chưa VAT, chi phí chưa VAT, lợi nhuận dự kiến + %.
- Bảng xem trước IC: nhóm A–F, dòng con thụt lề; dòng **lỗi tô đỏ**, dòng **cần xác nhận tô vàng**; ô sai in đậm đỏ (ví dụ "6 ≠ 10").
- Cột phải "AI kiểm tra": huy hiệu đếm Lỗi / Cần xác nhận / Gợi ý; mỗi lỗi có mô tả + ô Excel + 1–2 nút sửa.
- Thanh cuối: "Còn N lỗi cần chọn cách sửa" + **Lưu nháp IC** + **Lưu nháp IC & tạo báo giá**. Còn lỗi đỏ thì chỉ cho lưu nháp, không cho gửi duyệt.

**5.4 Bộ luật kiểm tra (chạy bằng code, sau khi AI tách dữ liệu)**
| Mã | Mức | Luật | Ví dụ trong IC_Pickerball |
|---|---|---|---|
| QTY_MISMATCH | Lỗi | SL bán ≠ SL mua cùng dòng | Bánh su kem: E17=10, J17=6 |
| VAT_DOUBLE | Lỗi | Dòng cộng VAT trên giá chưa chia (1+VAT) trong khi đa số dòng khác chia | Dòng 23–26, dư 2.464.000 đ nếu giá đã gồm VAT |
| EXTERNAL_LINK | Lỗi | Ô lấy số từ file khác | K33 → `../Downloads/IC_JABIL PICKLEBALL_22.10.xlsx` |
| SELL_UNCLEAR | Lỗi | Giá bán chỉ có ở một phần dòng / bằng giá vốn | F23–F25 = giá vốn; tổng bán trọn gói 82 tr |
| VAT_BLANK | Cần xác nhận | Ô VAT trống (khác 0%) | Dòng 16–17 |
| ZERO_PRICE | Cần xác nhận | Đơn giá 0 không có ghi chú/NCC | Dòng 10 Phí vệ sinh |
| MULTI_PAYEE | Cần xác nhận | Một ô NCC chứa nhiều người | "GIÀU, TÚ ANH, NÂU" |
| SCHEDULE_FORMULA | Cần xác nhận | Công thức lịch thanh toán không đồng nhất / vùng SUMIF lệch | Y17 bỏ cột 04/11; SUMIF O8:O132 vs N8:N33 |
| SUPPLIER_UNKNOWN | Cần xác nhận | NCC chưa có trong Danh bạ (so với `lib/costflow/supplierReadModel.ts`) | 11 NCC |
| TOTAL_MISMATCH | Lỗi | Tổng tính lại ≠ ô tổng trong file | (file mẫu khớp: 55.998.400 đ) |
| STT_GAP | Gợi ý | STT nhảy số / thiếu mục | Thiếu mục C; nhóm E 1,2,4… |
| FRACTION_PRICE | Gợi ý | Đơn giá lẻ do chia 1,08 | Dòng 9, 11, 13, 18, 19 |
| TEXT_DATE | Gợi ý | Ngày lưu dạng chữ | "04.11.2026" |

**5.5 Nguyên tắc bắt buộc**
- AI **chỉ tạo nháp**. Không tự gửi duyệt, không đổi ngân sách/tiền/doanh thu.
- Server **tính lại mọi số tiền**; số từ AI chỉ để hiển thị gợi ý.
- Ô trống ≠ 0 (giữ quy tắc CostFlow).
- **Bảo mật:** nội dung file được gửi sang Google Gemini → cần lãnh đạo công ty đồng ý; che STK/thông tin cá nhân trước khi gửi; không lưu file gốc lâu hơn thời hạn phiên xem trước (`EXCEL_INTAKE_PREVIEW_TTL_MS`).
- Có hạn mức chi phí/ngày như tính năng biên bản họp.
- Khi AI lỗi/hết hạn mức: báo rõ và cho dùng lại "Excel mẫu v4".

**5.6 Test**
- Unit: `tests/ai-intake-checks.test.ts` (mỗi luật 1 ca đúng + 1 ca sai), `tests/ai-intake-grid.test.ts`, `tests/ai-intake-redact.test.ts`.
- Gemini được **giả lập** trong test (không gọi mạng).
- Fixture: bản ẩn danh của `IC_Pickerball.xlsx` (xoá thông tin chuyển khoản) đặt ở `tests/fixtures/ai-intake/` — **cần chủ sản phẩm đồng ý** trước khi đưa file vào repo.
- Nghiệm thu với file thật: AI tách đúng 5 nhóm, 20 dòng chi phí, 11 NCC; tổng vốn 52.959.348 đ (55.998.400 đ gồm VAT); phát hiện đủ 4 lỗi + 5 mục cần xác nhận ở bảng 5.4.

---

## 4. Nguyên tắc CostFlow không được phá

Trích từ `docs/COSTFLOW_WORKFLOW_ARCHITECTURE.md` — mọi WP phải giữ:
1. Ô tiền trống là "chưa biết"; 0 là giá trị cố ý.
2. Báo giá cho khách và IC là hai bản ghi, hai vòng đời riêng.
3. Bản đã gửi/đã hiệu lực không tự tính lại khi đổi tham số/template.
4. Một người giữ nhiều vai trò vẫn quyết định riêng từng bước.
5. Hiệu lực do Quản lý ≠ kết quả của CEO.
6. Duyệt hồ sơ ≠ đã chi tiền.
7. Bản cho khách không bao giờ chứa giá vốn, NCC, minh chứng nội bộ, ghi chú nội bộ.

---

## 5. Lệnh kiểm tra trước khi mở PR

```bash
npm ci
npx tsc --noEmit
npx eslint <các file đã sửa>
npm test                      # unit (tests/*.test.ts)
npm run test:costflow         # bộ CostFlow
# Tích hợp DB (chỉ database test riêng):
COSTFLOW_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/costflow_test npm run test:costflow -- --integration
npm run build:app
```

Lưu ý: trên nhánh preview hiện có **26 test lỗi sẵn** (cần DB hoặc thiếu file `components/ExpenseDetailDrawer.tsx`). So danh sách lỗi trước/sau để chắc không phát sinh lỗi mới.

Mỗi PR: nhắm vào `preview/costflow-ui-refactor`, dùng mẫu `.github/pull_request_template.md`, đính kèm ảnh chụp màn hình so với khung tham chiếu tương ứng.

---

## 6. Câu hỏi còn mở (chủ sản phẩm trả lời)

1. Công ty có đồng ý gửi nội dung file Excel (đã che STK) sang Google Gemini không?
2. Bước làm tròn giá bán mặc định: 1.000 đ hay 10.000 đ?
3. Lịch thanh toán NCC trong file (cột S–Z) có cần AI nhập thành lịch tạm ứng/thanh toán trong app ở đợt này không, hay để đợt sau?
4. Có cho phép đưa bản ẩn danh của `IC_Pickerball.xlsx` vào repo làm dữ liệu test không?

---

## Phụ lục A — Kết quả phân tích file `IC_Pickerball.xlsx`

- 1 sheet `IC`. Khách hàng: Jabil. Thời gian: 04.11.2026 (dạng chữ). Địa điểm: Pickleball Văn Thánh.
- Bố cục: cột A–G phía **báo giá** (STT, Hạng mục, Chi tiết, ĐVT, SL, Thành tiền, Ghi chú); cột I–P phía **IC** (ĐVT, SL, Đơn giá, Thành tiền, VAT, Tổng cộng, SUP, Ghi chú); cột S–Z **lịch thanh toán NCC** (SUP, Tổng, 27/10, 30/10, 03/11, 04/11, Sau chương trình, Thông tin chuyển khoản).
- 5 nhóm: A. Địa điểm · B. Dụng cụ thi đấu · D. Teabreak (dòng cha "Menu teabreak" + 4 món con ở cột C) · E. Trao giải · F. Nhân sự.
- Tổng: vốn chưa VAT 52.959.348 đ · VAT vào 3.039.052 đ · vốn gồm VAT 55.998.400 đ (khớp với tổng lịch thanh toán) · bán trọn gói 82.000.000 đ gồm VAT 8% (ô F34 nhập cứng `=82000000/1.08`) · lợi nhuận 22.966.578 đ (30,2%).
- VAT 8% được ghi cứng trong công thức (`=L*0.08`).
- Kết quả bộ đọc hiện có: bản `main` đọc sai (1 nhóm, doanh thu 24,5 tr, lãi −116%); bản preview từ chối file vì liên kết ngoài.
- Danh sách lỗi chi tiết: xem bảng mục 5.4.
