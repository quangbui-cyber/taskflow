# Workflow — quy trình chuẩn

Phạm vi tích hợp hiện tại: **Phiếu đề nghị tạm ứng** và **Phiếu đề nghị hoàn tạm ứng**, dùng nền duyệt tuần tự chung với CostFlow. Mỗi mẫu có mã loại và chuỗi phiên bản riêng; công bố bản tạm ứng mới không làm mẫu hoàn tạm ứng thành bản cũ. Tờ trình chung/hợp đồng đã lưu vẫn đọc được; tích hợp và pilot hợp đồng được người dùng hoãn. Truy cập `/workflow`. Nội dung văn bản do công ty soạn và tải lên; hệ thống không soạn điều khoản hợp đồng.

Hai ảnh mẫu do người dùng cung cấp ngày 2026-10-02 là nguồn bố cục/thông tin đã chọn; PNG được hỗ trợ. Admin là owner xác nhận nội dung cả hai mẫu và công bố đúng phiên bản. Phân công dự kiến theo tên đã chốt: VÕ PHẠM TRỌNG HUY → BÙI DUY QUANG → ĐỖ VŨ PHƯƠNG UYÊN → ĐOÀN THÁI SƠN. Cần đối chiếu ID tài khoản đang hoạt động, Quản lý trực tiếp và Admin khi cấu hình; tên không tự cấp quyền. Các khối ký trên ảnh cần Admin xác nhận theo mẫu, không phải bằng chứng ký thật. Luồng hiện có lưu nội dung và file hồ sơ đã điền; chưa tự sinh phiếu hay ghi tiền từ mẫu này.

## Cấu hình trước khi sử dụng

1. Admin vào **Mẫu & phân công**, lưu file mẫu công ty, owner nội dung, Kế toán, CEO, người/bên ký và hướng dẫn thông tin/tài liệu bắt buộc. Có thể lưu cấu hình nháp còn thiếu.
2. Owner đọc file và xác nhận nội dung đúng phiên bản. Thiếu file, hướng dẫn, người ký hoặc người xử lý đang hoạt động thì chưa xác nhận/công bố được. Admin không thay owner xác nhận, trừ khi chính Admin được phân công owner.
3. Admin công bố bản đã được owner xác nhận. Bản công bố giữ nguyên; sửa bằng phiên bản mới và xác nhận lại. Quản lý trực tiếp lấy từ tài khoản người lập; thiếu người xử lý thì chặn gửi, không tự bỏ bước.

Các file và tài khoản trong database `costflow_test` chỉ phục vụ kiểm thử local. Đã có hai ảnh mẫu người dùng chọn và bốn tên phân công; tài khoản thật, cấu hình ký/checklist đúng phiên bản và hồ sơ pilot chưa được nghiệm thu. Không sao chép dữ liệu thử thành cấu hình công ty.

## Lập và duyệt

Người lập chọn mẫu công bố, lưu hồ sơ nội bộ độc lập hoặc gắn project mình là member. Khi gửi, cần nội dung và tài liệu chính đã lưu. Chuỗi cố định: Quản lý → Kế toán → CEO. Kế toán phải xác nhận đã kiểm tra đúng phiên bản, đủ thông tin/tài liệu, đối tác/số tiền/IC liên quan nếu có. Sai hoặc thiếu thì trả bổ sung với lý do.

Một tài khoản có thể tham gia nhiều vai trò, nhưng từng bước cần quyết định riêng. Admin không tự có quyền duyệt thay người được phân công. Hồ sơ, mẫu/SOP và tài liệu dùng lúc gửi được giữ đúng bản. Hồ sơ mới phải dùng bản mẫu công bố mới nhất; hồ sơ đang chạy giữ bản cũ.

Hồ sơ đã trả/rút/từ chối hoặc đã duyệt cần sửa tài liệu chính: người lập tạo bản mới liên kết hồ sơ cũ, tải tài liệu chính mới và gửi lại toàn bộ chuỗi. Quyết định/file cũ được giữ. File tham khảo được phân loại riêng, không thay tài liệu chính hoặc làm hồ sơ thành đã ký.

Người lập rút hồ sơ đang trình với lý do. Quản lý phụ trách hoặc Admin chuyển giao bước đang chờ hay người xác nhận bản ký với lý do. Không tự chuyển người theo thời hạn. Server kiểm tra actor, module, phiên bản và cập nhật đồng thời; dữ liệu đã đổi yêu cầu tải lại, không ghi thêm quyết định trùng.

## Ký giấy và đọc file

Sau duyệt, người lập tải tài liệu chính đúng bản để ký ngoài hệ thống; tải scan/ảnh bộ hồ sơ đã ký và ghi người giữ/nơi lưu bản gốc. Thao tác này tạo trạng thái **Bản ký chờ Quản lý xác nhận**. Quản lý phụ trách xác nhận đủ chữ ký theo mẫu và thông tin lưu gốc mới thành **Đã xác nhận đủ bản ký**. Duyệt, ký và thực hiện hoàn tất là trạng thái riêng; phần xác nhận thực hiện sau duyệt chưa triển khai trong lát cắt này.

Trang **In / lưu PDF trang thông tin hồ sơ** là trang thông tin có mã hồ sơ/mẫu/file và trạng thái. Nó không thay tài liệu chính do công ty soạn hoặc bằng chứng ký. In PDF dùng cửa sổ in trình duyệt; chưa kiểm thử xuất PDF vật lý trên máy in.

Project member/Admin đọc hồ sơ gắn project. Hồ sơ độc lập: người lập, người được phân công hoặc Admin đọc. File được tải qua route có kiểm tra quyền parent, không đưa bytes vào danh sách. Hỗ trợ PDF/DOCX/XLSX/JPG/PNG, tối đa 4 MiB mỗi tệp (giao diện hiển thị 4 MB); bytes và SHA-256 lưu bền vững. Giữ lịch sử/file, không tự xóa. Liên kết CostFlow chỉ tra cứu hồ sơ được phép đọc; không tự tạo hồ sơ tài chính hoặc giao dịch tiền.

## Nhắc việc và kiểm chứng

Giao diện 2026-10-02: hàng chờ và chi tiết dùng Sidebar/shell hiện có, đánh dấu Hồ sơ của tôi đang mở. Bảng hồ sơ có bộ lọc Tất cả/Chờ tôi xử lý/Tôi lập, tìm theo tên/project và 12 hồ sơ mỗi trang; dữ liệu đầu vào vẫn lọc quyền ở server. Lập hồ sơ và cấu hình mẫu ở tab riêng; file, duyệt, ký và hoàn tất giữ đúng các hành động/trạng thái hiện có. Trang in độc lập với shell. Bộ lọc là tiện ích đọc, không cấp quyền hoặc thay quyết định.

Nhắc việc/tính quá hạn chưa bật theo lựa chọn W-B08. Cần lịch làm việc, ngày nghỉ, hạn và nhịp nhắc do công ty xác nhận trước khi triển khai. Không tự dùng lịch hoặc deadline mặc định.

Kiểm chứng 2026-10-02: Prisma validate/generate, TypeScript, ESLint các file thay đổi và build Next.js 16.2.10 pass. `npm.cmd run test:costflow -- --integration` đạt 8/8, gồm 6 kiểm thử đơn vị và hai suite DB CostFlow/Workflow. Hai suite chạy tuần tự; mỗi suite vẫn kiểm tra thao tác đồng thời. URL integration chỉ cho database local `costflow_test`. Migration mới `20261002060000_workflow_templates_documents` đã chạy trên DB thử, tổng 28 migrations; chưa migrate/deploy môi trường vận hành.

Browser đã thử upload mẫu → owner xác nhận → công bố → lưu nháp/file → reload → ba quyết định → upload bản ký → Quản lý xác nhận → reload/tải file. File tải về khớp SHA-256; không có lỗi console. Dữ liệu thử không chứng minh mẫu/nội dung pháp lý/chữ ký thật được công ty nghiệm thu. Bộ CostFlow hiện có vẫn pass; chưa chứng minh đầy đủ hồi quy hoặc production readiness.

## Danh mục và phiên bản Phase 4

Xem [WORKFLOW_CATALOG.md](WORKFLOW_CATALOG.md) cho checklist theo phiên bản, nháp mẫu cũ, lần gửi và kiểm chứng local cập nhật (28/28 tests). Số liệu kiểm thử ở các đoạn phía trên mô tả lát cắt Phase 2 trước đó.


## Phase 5 — phê duyệt, bàn giao và vòng đời

Hàng chờ dùng ba chế độ **Chờ tôi xử lý / Tôi đã xử lý / Hồ sơ tôi lập**, sắp theo thời điểm đến bước và có hành động duyệt ngay trên từng hàng. Mọi quyết định khóa theo module, lần trình, phiên bản gửi và bước hiện tại; cùng người giữ nhiều vai trò vẫn phải quyết định từng bước. Kế toán xác nhận rõ đã kiểm tra dữ liệu, chứng từ và liên kết trước khi duyệt.

Trả hồ sơ cần lý do chung và ít nhất một nội dung phải sửa. Bản gửi lại giữ liên kết với kết quả cũ, cần một phản hồi chung và chạy lại chuỗi chuẩn; bản cũ, quyết định và file/hash không bị sửa. Chuyển giao bước chỉ nhận tài khoản đang hoạt động có đúng vai trò chuẩn hoặc vai trò bổ sung do Admin cấp. Người xử lý cũ giữ quyền đọc đúng hồ sơ đã chuyển, không nhận quyền project hay quyền quyết định bước cũ.

Sự kiện duyệt và ý định thông báo được lưu cùng transaction. Thông báo được tạo sau commit, có khóa chống trùng và tối đa ba lần thử; lỗi thông báo không đảo ngược quyết định nghiệp vụ. Link thông báo dẫn đúng chi tiết Workflow hoặc hồ sơ CostFlow.

Người lập có thể yêu cầu hủy hồ sơ Workflow đã duyệt khi chưa có bản ký và chưa bắt đầu thực hiện. Quản lý phụ trách quyết định; trong thời gian chờ, ký và bắt đầu thực hiện bị giữ. Bản thay thế của hồ sơ đã duyệt không làm bản cũ mất hiệu lực khi còn nháp/đang duyệt; chỉ duyệt đủ mới đánh dấu bản cũ đã được thay thế, và giao dịch từ chối/trả/rút giữ bản cũ hiện hành.

Kiểm chứng local ngày 2026-10-03: TypeScript và ESLint file Phase 5 đạt; 5/5 unit test đạt. DB integration chưa chạy vì chưa có `COSTFLOW_TEST_DATABASE_URL`. Build bị chặn ở `prisma generate` bởi DLL Windows đang bị khóa (`EPERM rename query_engine-windows.dll.node`); Prisma client `--no-engine` chỉ dùng cho typecheck. Chưa có browser/UAT Phase 5 và chưa có nghiệm thu công ty hay production.

Bổ sung kiểm chứng: runner đầy đủ với endpoint test từng dùng phát hiện 34 tests, 24 pass/10 fail; cả 10 lỗi là PostgreSQL không chạy ở `127.0.0.1:55439`. Vì vậy vẫn chưa có DB pass hoặc migration readback cho Phase 5.

## Phase 6 — policy IC dùng nền phê duyệt chung

IC tiếp tục dùng cùng request, attempt, step, decision, approval event và delivery intent của Workflow; không có approval engine thứ hai. Policy mặc định vẫn yêu cầu lý do khi trả/từ chối và nội dung cần sửa khi trả. Chỉ quyết định RETURN/REJECT của CEO trên IC CostFlow nhận `reasonOptional`; các tổ hợp module/loại hồ sơ/vai trò khác không thay đổi.

Sự kiện Account gửi, Quản lý, Kế toán và CEO giữ actor, attempt, submitted version, mutation version, bước, thời điểm và ghi chú. Timeline hiển thị Account là sự kiện gửi chứ không phải một cấp duyệt. CEO không ghi chú hiển thị `Không có ghi chú`, không bị diễn giải thành thiếu dữ liệu. Ý định thông báo được lưu bền vững cùng quyết định; kết quả transport sau commit là trạng thái riêng và lỗi transport không được yêu cầu người dùng duyệt lại.

Phân tách trạng thái vẫn bắt buộc: approval khác budget effect; cả hai khác payment authorization, actual cash, signature, task completion và financial close. Bằng chứng local Phase 6 không thay nghiệm thu phân vai công ty, provider delivery hoặc production deployment.
