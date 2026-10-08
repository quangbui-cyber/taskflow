# Tài liệu Kỹ thuật & Nghiệp vụ: Cải tiến Giao diện và Luồng Thanh toán CostFlow (CostFlow UI & Payment Refactor)

> **Nhánh:** `codex/costflow-ui-refactor`  
> **Hệ thống:** TaskFlow / CostFlow & Workflow  
> **Trạng thái:** Sẵn sàng nghiệm thu (Đã kiểm tra TypeScript strictly typed, ESLint 0 lỗi, 61/61 Unit Tests pass, 2/2 Integration Tests pass trên PostgreSQL test cục bộ)

---

## 1. Bối cảnh & Mục tiêu

Hệ thống **CostFlow** được phát triển nhằm quản lý tài chính trọn vòng đời cho các dự án của Creative Station, từ giai đoạn dự toán chi phí nội bộ (Internal Cost - IC), quản lý báo giá khách hàng (Quotation), ghi nhận chi phí phát sinh thực tế (Actual Cost - AC), phê duyệt đề nghị tạm ứng/thanh toán/hoàn ứng, đến sổ quỹ tiền mặt và quyết toán đa bên.

Đợt cập nhật này tập trung vào hai trụ cột chiến lược:
1. **Kiến trúc dữ liệu & Hồ sơ thanh toán chuẩn hóa (Phase 7 - Normalized Payment Dossier):**  
   - Bổ sung cấu trúc dữ liệu bền vững (relational persistence) cho các dòng đề nghị thanh toán (`PaymentRequestLine`), snapshot người thụ hưởng (`PaymentRecipientSnapshot`), phân bổ giao dịch tiền mặt (`CostFlowCashAllocation`), và trao đổi thảo luận theo dòng (`PaymentLineDiscussion`).
   - Ràng buộc chặt chẽ hiệu lực chi tiền: Phiếu đề nghị thanh toán (ĐNTT) và Hoàn tạm ứng (ĐNHTU) chỉ có hiệu lực giải ngân tiền thực tế khi toàn bộ chi phí AC đính kèm đã có đầy đủ hóa đơn GTGT + bằng chứng chi tiền (hoặc đã được phê duyệt ngoại lệ hợp lệ).
   - Cơ chế Trả hồ sơ (RETURN) sinh bản nháp liên kết (`parentId`), cho phép Người lập nộp lại (`RESUBMIT_PAYMENT_DOSSIER`) kèm diff so sánh tự động (`PaymentDossierDiff`).
2. **Tối ưu hóa Giao diện người dùng & Trải nghiệm thao tác (UI/UX Refactoring):**  
   - Hợp nhất cấu trúc tab từ 8 tab phân tán thành **6 tab chuẩn vòng đời tài chính**, giảm thiểu chuyển tab trùng lặp.
   - Thêm tính năng **Live Margin** so sánh giá bán (Quotation) vs giá mua (IC) theo thời gian thực và cảnh báo margin thấp.
   - Bổ sung **Bảng lịch thanh toán & tạm ứng NCC** (`VendorPaymentScheduleTable`) theo đợt hợp đồng, tích hợp nút tạo nhanh hồ sơ chi.
   - Nâng cấp **Modal chỉnh sửa dòng IC** (`EditIcLineModal`), **Modal ghi nhận chi phí AC** (`ExpenseUploadModal`), **Drawer chi tiết chi phí** (`ExpenseDetailDrawer`), và **Modal lập hồ sơ chi** (`ExpenseRequestModal`).

---

## 2. Kiến trúc Dữ liệu & Nghiệp vụ Backend

### 2.1. Cấu trúc Quan hệ & Tính Bất biến (Relational Persistence)

Các hồ sơ đề nghị tạm ứng / thanh toán (ADVANCE, VENDOR_PAYMENT, REIMBURSEMENT) được lưu trữ chuẩn hóa theo mô hình quan hệ:
- **`WorkflowRequest`**: Đầu phiếu (Header), chứa loại hồ sơ (`kind`), trạng thái duyệt (`state`), bước duyệt hiện tại (`currentStep`), người lập (`creatorId`), người xác nhận tiền (`cashAssigneeId`).
- **`PaymentRequestLine`**: Từng dòng khoản chi chi tiết, gắn với `stableKey`, số tiền `amount`, liên kết dòng IC dự toán (`icRevisionId`, `icLineId`), và người nhận (`recipientKey`).
- **`PaymentRecipientSnapshot`**: Lưu giữ snapshot bất biến thông tin người thụ hưởng (tên, ngân hàng, 4 số cuối tài khoản, phiên bản xác minh) tại thời điểm nộp hồ sơ.
- **`PaymentLineDiscussion`**: Lưu trữ lịch sử trao đổi trực tiếp trên từng dòng khoản chi giữa người duyệt và người lập, hỗ trợ nhắc tên (@mention) các thành viên đang hoạt động trong dự án.
- **`CostFlowCashAllocation`**: Quan hệ phân bổ nhiều-nhiều giữa giao dịch tiền thực tế (`CostFlowCash`) và các dòng đề nghị thanh toán (`PaymentRequestLine`).

### 2.2. Tách biệt 7 Trục Nghiệp vụ Độc lập

Hệ thống bảo đảm 7 trạng thái độc lập, không suy diễn lẫn nhau:
1. **Approval State:** Trạng thái phê duyệt hồ sơ (DRAFT → SUBMITTED → APPROVED / RETURNED / REJECTED).
2. **Budget Effectiveness:** Hiệu lực ngân sách IC bắt đầu ngay sau khi **Quản lý duyệt** và không tự mất hiệu lực nếu CEO trả/từ chối.
3. **Payment Authorization:** Phê duyệt đề nghị chi cho phép giải ngân, nhưng không thay thế cho giao dịch tiền thật.
4. **Cash Movement:** Giao dịch quỹ tiền mặt/ngân hàng (`CostFlowCash`) độc lập, chỉ được ghi nhận bởi người được giao xử lý tiền (`cashAssigneeId`) sau khi hồ sơ đã duyệt.
5. **Signing & Custody:** Ký giấy và lưu trữ hồ sơ độc lập.
6. **Task Completion:** Hoàn thành nhiệm vụ công việc độc lập với tài chính.
7. **Financial Close:** Đóng tài chính dự án (`closed`) chỉ thực hiện khi tất cả công nợ đối soát về 0 và đầy đủ chứng từ.

### 2.3. Ràng buộc Hiệu lực Thanh toán (Disbursement Invariants)

Khi Kế toán hoặc Thủ quỹ thực hiện lệnh xác nhận chi tiền (`CASH` command) trong `lib/costflow/service.ts`:
- Đối với `REIMBURSEMENT` (Hoàn tạm ứng) và `VENDOR_PAYMENT` (Thanh toán trực tiếp NCC có đính kèm khoản AC):
  Hệ thống kiểm tra toàn bộ các khoản AC liên quan. Nếu có bất kỳ khoản AC nào thiếu hóa đơn hoặc thiếu bằng chứng chi tiền, đồng thời chưa có trạng thái ngoại lệ `APPROVED`:
  ```typescript
  if (targetExpenses.length > 0 && targetExpenses.some(e => !isExpenseApproved(e))) {
    throw new Error("Phiếu chưa có hiệu lực thanh toán: Khoản chi AC đính kèm chưa được duyệt đầy đủ (cần đủ hóa đơn + bằng chứng chi hoặc đã được duyệt ngoại lệ).");
  }
  ```
- Đối với thanh toán Nhà Cung Cấp (`VENDOR:`): Người thụ hưởng phải khớp đúng phiên bản đã được Kế toán xác minh (`verifiedVersion === version`).

---

## 3. Chi tiết Cải tiến Giao diện (UI/UX Improvements)

### 3.1. Hợp nhất Cấu trúc Điều hướng (Tab Restructuring)

Thay vì 8 tab phân mảnh gây khó khăn cho người dùng khi theo dõi dòng tiền, CostFlow được chuẩn hóa thành 6 tab phản ánh đúng chu trình công việc:
1. **Tổng quan (`overview`):** Dashboard tài chính dự án, tóm tắt PO, IC hiệu lực, AC phát sinh, tỷ suất lợi nhuận Margin và cảnh báo chứng từ.
2. **Scope & Báo giá (`scope`):** Đăng ký tài liệu Brief/PO, soạn thảo và xuất bản Báo giá khách hàng theo phiên bản.
3. **Internal Cost (`ic`):** Dự toán chi phí nội bộ, phân bổ Nhà Cung Cấp, tính toán tỷ lệ Margin thời gian thực, lập kế hoạch thanh toán NCC theo đợt.
4. **Actual Cost (`expense`):** Theo dõi chi phí thực tế phát sinh, đối soát tạm ứng theo nhân sự, upload hóa đơn/UNC và kiểm duyệt chứng từ.
5. **Hồ sơ & Trình duyệt (`approvals`):** Trung tâm lập và xử lý hồ sơ chi (ĐNTU, ĐNTT, ĐNHTU), phê duyệt đa cấp theo chuỗi Quản lý → Kế toán → CEO, quản lý danh bạ NCC.
6. **Tiền & Quyết toán (`close`):** Sổ quỹ thu chi thực tế, xác nhận giải ngân, bảng đối soát đa bên (nhân viên, NCC, công ty) và chốt quyết toán đóng dự án.
7. *(Phân công - `settings`)*: Dành riêng cho Admin cấu hình Kế toán, CEO và Quản lý phụ trách.

> **Tương thích ngược (Backward Compatibility):** Hàm `resolveTab` tự động chuyển hướng các liên kết cũ `tab=requests` sang tab `approvals`, đảm bảo không làm đứt gãy luồng chuyển trang từ thông báo hoặc email.

---

### 3.2. Màn hình Internal Cost (`InternalCostPanel`)

- **Sub-view 1: Bảng Hạng Mục & NCC (`items`):**
  - Cột **Giá bán (Báo giá)** và **Giá vốn (IC)** hiển thị song song.
  - Cột **Margin (Lợi nhuận ròng & %)**: Tính toán tự động tỷ lệ `(Giá bán - Giá mua) / Giá bán * 100%`. Tự động đánh dấu tone `warning` nếu margin < 25%.
  - Hiển thị thông tin Nhà Cung Cấp được giao khoán kèm số tài khoản ngân hàng.
  - Nút **Sửa dòng** mở `EditIcLineModal` tiện lợi.
- **Sub-view 2: Lịch Thanh Toán NCC (`schedule` - `VendorPaymentScheduleTable`):**
  - Tự động gom nhóm các dòng IC theo từng Nhà Cung Cấp để tính tổng giá trị hợp đồng NCC.
  - Cho phép thiết lập các đợt thanh toán (Installments) linh hoạt (Ví dụ: Đợt 1 Tạm ứng cọc 40%, Đợt 2 Trước chạy 50%, Đợt 3 Nghiệm thu 10%).
  - Tự động tính số tiền theo tỷ lệ %, kiểm soát hạn thanh toán (`dueDate`).
  - Nút hành động nhanh: **"Lập ĐNTU"** hoặc **"Lập ĐNTT"** tự động điền sẵn tên NCC, số tiền và nội dung sang form lập hồ sơ chi.
- **Sub-view 3: So Sánh & Lịch Sử (`revisions`):**
  - So sánh chi tiết thay đổi giữa các phiên bản IC (IC Revision Diff).
  - Kiểm tra cập nhật khi Báo giá nguồn có phiên bản mới hơn.

---

### 3.3. Modal Chỉnh sửa Dòng IC Song Song (`EditIcLineModal`)

- Thiết kế dialog độ rộng lớn (`tf-edit-ic-line-modal`, tối đa 1120px) bố cục 2 cột rõ ràng.
- Cột trái: Thông tin liên kết Báo giá khách hàng, tự động đồng bộ số lượng và đơn vị tính nếu chưa có.
- Cột phải: Nhập giá vốn, thuế suất VAT (8%, 10%, 0%), hình thức NET/GROSS.
- Khung **Live Margin Indicator**: Xem trước ngay lợi nhuận ròng và tỷ lệ phần trăm biên lợi nhuận trước khi lưu.
- Khung **Chọn Nhà Cung Cấp**: Tích hợp danh bạ người thụ hưởng có sẵn, hiển thị tên ngân hàng và số tài khoản đã xác minh.

---

### 3.4. Màn hình Actual Cost (`ActualCostPanel`)

- **3 Chế độ xem linh hoạt:**
  1. *Theo nhân sự / NCC (`by-member`):* Bảng theo dõi số tiền đã tạm ứng (OUT), số tiền đã hoàn ứng (IN), tổng chi thực tế đã báo cáo và công nợ hiện tại. Nút tắt **"Lập ĐNHTU"** lập tức tạo phiếu hoàn ứng cho nhân sự tương ứng.
  2. *Theo dòng IC (`by-line`):* Dạng accordion xem tiến độ giải ngân thực tế so với ngân sách dự toán ban đầu của từng dòng IC.
  3. *Tất cả khoản chi (`all-expenses`):* Bảng danh sách chi tiết toàn bộ các khoản AC với các bộ lọc thông minh: Đầy đủ chứng từ, Thiếu chứng từ, Khoản chi có ngoại lệ.
- **Tích hợp Modal & Drawer mới:**
  - `ExpenseUploadModal`: Nhập chi phí AC mới, chọn nguồn quỹ chi trả (`fundingSource`: ADVANCE - Quỹ tạm ứng, OUT_OF_POCKET - Tiền túi cá nhân, VENDOR_DIRECT - Thanh toán trực tiếp NCC), đính kèm hóa đơn và ủy nhiệm chi, tùy chọn giải trình ngoại lệ nếu thiếu chứng từ.
  - `ExpenseDetailDrawer`: Drawer trượt phải hiển thị đầy đủ thông tin khoản chi, xem trước chứng từ, và cho phép Quản lý / Kế toán duyệt hoặc từ chối giải trình ngoại lệ.

---

### 3.5. Màn hình Hồ sơ & Trình duyệt (`ApprovalRequestsPanel` & `ExpenseRequestModal`)

- **Modal Lập hồ sơ chi toàn diện (`ExpenseRequestModal`):**
  - Hỗ trợ 3 loại phiếu chuẩn: **ĐNTU** (Đề nghị tạm ứng), **ĐNTT** (Đề nghị thanh toán trực tiếp NCC), **ĐNHTU** (Đề nghị hoàn tạm ứng).
  - Tích hợp tab **"Thêm mới NCC"**: Cho phép Account thêm nhanh Nhà Cung Cấp mới cùng thông tin ngân hàng ngay khi đang lập hồ sơ mà không cần rời trang.
  - Hỗ trợ chọn danh sách các khoản AC đính kèm để tự động tính tổng tiền hoàn ứng hoặc thanh toán.
- **Thẻ hồ sơ nâng cao (`EnhancedRequestCard`):**
  - Hiển thị khung **Review hồ sơ chuẩn hóa** (`PaymentRequestReview`) và theo dõi thay đổi (`PaymentDossierDiff`) khi hồ sơ nộp lại.
  - Huy hiệu cảnh báo **Hiệu lực giải ngân**:
    - *Đã duyệt AC (Đủ điều kiện chi):* Toàn bộ khoản AC đã đủ chứng từ hợp lệ.
    - *Chờ duyệt AC (Chưa thể giải ngân):* Cảnh báo rõ cho Kế toán và người lập rằng hồ sơ có thể duyệt trước về mặt chủ trương, nhưng chỉ được giải ngân thực tế khi đã bổ sung đủ hóa đơn/bằng chứng chi.
  - Tích hợp khung thảo luận theo dòng (`PaymentLineDiscussion`).

---

### 3.6. Màn hình Tiền & Quyết toán (`SettlementPanel`)

- **Bảng Theo dõi Giải ngân Chờ xác nhận (`Pending Disbursements`):**
  - Liệt kê các phiếu đã được phê duyệt đầy đủ nhưng chưa có giao dịch chi tiền thực tế.
  - Đánh dấu trạng thái đủ điều kiện chi tiền hoặc bị chặn bởi chứng từ AC chưa hoàn tất.
  - Nút **"Xác nhận chi tiền"** mở modal cho Kế toán / Thủ quỹ nhập mã giao dịch ngân hàng, ngày chi và đính kèm ủy nhiệm chi.
- **Sổ quỹ Dự án (Cash Ledger):**
  - Thống kê tổng tiền ra (Chi tạm ứng, chi thanh toán), tổng tiền vào (Thu hoàn ứng), và số dư ròng đã giải ngân.
- **Đối soát Đa bên (Multi-party Reconciliation Ledger):**
  - Tính toán chi tiết cho từng cá nhân và NCC: Chi phí Gross thực tế, Tiền đã thanh toán/tạm ứng, Tiền đã thu hoàn, Khoản công ty cần chi bổ sung, hoặc Khoản cá nhân cần nộp hoàn.
- **Bộ chặn Đóng Dự án (Financial Close Blockers):**
  - Kiểm tra nghiêm ngặt: (1) Số dư công nợ của tất cả các bên phải bằng 0; (2) Tất cả chi phí AC phải đủ hóa đơn và chứng từ thanh toán (hoặc đã duyệt ngoại lệ); (3) Tất cả giao dịch tiền mặt phải có chứng từ đính kèm.

---

## 4. Kiểm thử & Đảm bảo Chất lượng (Quality Assurance)

Tất cả các thay đổi đã trải qua quy trình kiểm thử nghiêm ngặt trước khi commit:

1. **TypeScript Typecheck:**
   ```powershell
   npx tsc --noEmit
   # Kết quả: Exit 0 - Không có bất kỳ lỗi kiểu dữ liệu nào.
   ```
2. **ESLint Code Quality:**
   ```powershell
   npm run lint
   # Kết quả: Exit 0 - 0 lỗi, 0 cảnh báo.
   ```
3. **Unit Tests (Business Logic & Policies):**
   ```powershell
   node scripts/test-costflow.mjs
   # Kết quả: 61/61 tests pass cleanly (100% pass, 0 fail, 0 skip).
   ```
4. **Integration Tests (PostgreSQL Test Database):**
   ```powershell
   $env:DATABASE_URL="postgresql://postgres@127.0.0.1:55439/taskflow"
   npx tsx -C react-server --test tests/payment.integration.test.ts
   # Kết quả: 2/2 tests pass (Guard DB, Canonical 75m dossier with multi-recipients, return & resubmit diff, line discussion with project mentions).
   ```

---

## 5. Danh sách Tệp thay đổi & Tạo mới

### Các tệp cập nhật:
- `taskflow/lib/costflow/types.ts`: Bổ sung kiểu `ExpenseFundingSource`, `VendorPaymentMilestone`, mở rộng `Expense` và `FinanceData`.
- `taskflow/lib/costflow/money.ts`: Bổ sung hàm tiện ích `calculateMargin` (tính lợi nhuận ròng, tỷ lệ %, định dạng số dương/âm).
- `taskflow/lib/costflow/budgetQuotation.ts`: Bổ sung hàm `matchIcLineToQuotation` ánh xạ dòng IC với Báo giá khách hàng.
- `taskflow/lib/costflow/reconciliation.ts`: Bổ sung hàm `isExpenseApproved`, cập nhật điều kiện `closeBlockers` và `settlement`.
- `taskflow/lib/costflow/service.ts`: Xử lý command `ADD_PAYMENT_LINE_DISCUSSION`, tạo bản sửa liên kết khi `RETURN`, chặn chi tiền `CASH` nếu chi phí AC chưa được duyệt hợp lệ.
- `taskflow/components/CostFlowPanel.tsx`: Tối ưu cấu trúc 6 tab chuẩn, ánh xạ URL `tab=requests` sang `approvals`, điều hướng lập hồ sơ chi.
- `taskflow/components/InternalCostPanel.tsx`: Thêm 3 sub-views (items, schedule, revisions), Live Margin, tích hợp `VendorPaymentScheduleTable` và `EditIcLineModal`.
- `taskflow/components/ActualCostPanel.tsx`: Thêm 3 chế độ xem (by-member, by-line, all-expenses), thẻ thống kê, tích hợp `ExpenseUploadModal` và `ExpenseDetailDrawer`.
- `taskflow/components/ApprovalRequestsPanel.tsx`: Tích hợp `ExpenseRequestModal`, cảnh báo hiệu lực giải ngân thanh toán, review hồ sơ chuẩn hóa.
- `taskflow/components/SettlementPanel.tsx`: Nâng cấp sổ quỹ thu chi, danh sách chờ giải ngân, đối soát đa bên và chốt quyết toán.
- `taskflow/components/PaymentCashPanel.tsx`: Cập nhật logic giải ngân, loại bỏ `any`, chuẩn hóa trạng thái khởi tạo.
- `taskflow/components/ui/Dialog.tsx` & `taskflow/app/modules.css`: Bổ sung class `tf-dialog-wide` và styling cho modal độ rộng lớn.
- `taskflow/proxy.ts`: Tối ưu CSP nonce handling.
- `taskflow/tests/payment.integration.test.ts`: Bổ sung kiểm thử tích hợp cho trao đổi dòng chi phí, kiểm tra quyền mention và luồng nộp lại hồ sơ sau khi bị trả.

### Các tệp tạo mới:
- `taskflow/components/EditIcLineModal.tsx`: Modal chỉnh sửa dòng IC và so sánh Báo giá song song, Live Margin indicator, chọn Nhà Cung Cấp.
- `taskflow/components/VendorPaymentScheduleTable.tsx`: Bảng quản lý đợt thanh toán NCC theo % giá trị hợp đồng, hạn thanh toán và tạo nhanh hồ sơ chi.
- `taskflow/components/ExpenseUploadModal.tsx`: Modal ghi nhận chi phí AC mới theo nguồn quỹ chi trả và chứng từ.
- `taskflow/components/ExpenseDetailDrawer.tsx`: Drawer xem chi tiết khoản chi AC, chứng từ đính kèm và duyệt ngoại lệ.
- `taskflow/components/ExpenseRequestModal.tsx`: Modal lập đề nghị tạm ứng / thanh toán / hoàn ứng và thêm mới NCC.
- `taskflow/components/costflow/payments/PaymentLineDiscussion.tsx`: Component thảo luận theo từng dòng chi phí.
- `taskflow/components/costflow/payments/PaymentRequestReview.tsx`: Component review hồ sơ thanh toán chuẩn hóa cho các cấp phê duyệt.
- `taskflow/docs/COSTFLOW_UI_PAYMENT_REFACTOR.md`: Tài liệu kỹ thuật và nghiệp vụ chi tiết cho lần thay đổi này.
