# CostFlow — luồng chuẩn, bản kiểm tra cục bộ

Triển khai theo ANSWER-019 (“đồng ý cả”) ngày 2026-10-02 và tám đề xuất B01–B08 đã trình. Quyết định làm tròn mới hơn được ưu tiên: số tiền tính toán làm tròn số nguyên gần nhất, đúng nửa thì ra xa 0; tổng cộng từ số gốc rồi mới làm tròn. Số lượng, đơn giá và chứng từ gốc được giữ.

## Sử dụng

1. Admin khai báo Kế toán, CEO và Quản lý tài chính trong tab **Phân công** của project. Quản lý duyệt hồ sơ thường lấy từ quản lý trực tiếp của người lập. Thiếu người xử lý thì không gửi được.
2. Mở project → **CostFlow → Scope & Báo giá → Đầu vào dự án**. Tải tài liệu vào project và đăng ký nguồn **Brief hoặc PO** — hai đầu vào cùng cấp; project chỉ có Brief vẫn lập báo giá/IC được. Chọn nguồn, nhập hạng mục và giá bán rồi lưu báo giá. Mỗi lần lưu giữ một phiên bản riêng; xuất đúng bản đã chọn bằng **Xuất báo giá → In / lưu PDF**. Chọn hạng mục để tạo IC và nhập giá vốn/VAT chi phí riêng. IC vẫn có thể lập trống hoặc sao chép bản trước, chưa cần PO/NCC. VAT phải rõ, nhập 0 khi không VAT; mặc định giá net.
3. Gửi IC qua Quản lý → Kế toán → CEO. IC có hiệu lực sau Quản lý; CEO trả/từ chối không tự bỏ hiệu lực. Cùng người xử lý nhiều bước vẫn có cảnh báo và ba quyết định riêng.
4. Ghi AC khi phát sinh, có thể bổ sung chứng từ sau. Thanh toán NCC có người thụ hưởng và căn cứ xác minh; Kế toán kiểm tra phiên bản thông tin tài khoản đang dùng. Sai thì trả hồ sơ; sửa thông tin phải kiểm tra lại.
5. Lập tạm ứng, thanh toán NCC hoặc **Đề nghị Hoàn Tạm Ứng**. Hoàn ứng cần IC/AC và chứng từ chi phí/chi thực tế đầy đủ. Hồ sơ bị trả có thể gửi lại thành bản mới liên kết bản cũ, duyệt lại từ Quản lý. Tạm ứng bổ sung cần giải trình.
6. Hồ sơ chi duyệt đủ chưa có nghĩa đã trả tiền. Account/người lập được phân công xác nhận giao dịch thật, nhập mã giao dịch, ngày, số tiền, phân bổ theo dòng IC và biên lai/phiếu thu chi. Có thể thanh toán nhiều đợt. Mã giao dịch trùng bị chặn.
7. Đối soát riêng từng nhân viên/NCC; ví dụ tạm ứng 10 triệu, chi thực tế 12 triệu thì chi thêm 2 triệu; chi 8 triệu thì thu hoàn 2 triệu. Margin = PO net − AC net phát sinh; không thay doanh thu sales của TaskFlow.
8. Nhân sự project yêu cầu đóng/mở tài chính; Quản lý tài chính được phân công duyệt. Đóng cần IC/AC, đủ chứng từ và số phải thu/phải trả bằng 0. Mở lại cho bổ sung chứng từ; đổi chi phí cần bản mới qua toàn chuỗi. Giao dịch cũ được giữ.

**Hồ sơ của tôi** tại `/workflow` gom hồ sơ do mình lập hoặc được phân công. Người ngoài membership chỉ thấy hồ sơ được giao. Quyền đọc project không cấp quyền duyệt hoặc xác nhận tiền.

## Phiếu và lịch sử

Phiếu hoàn ứng xuất Excel và trang **In / Lưu PDF** bằng chức năng in của trình duyệt. Chín cột nghiệp vụ theo mẫu: chứng từ, nội dung, chi thực tế gross, đã tạm ứng, chi bổ sung, thu hoàn và người nhận/STK. Bằng chữ lấy tổng chi thực tế gross; nguồn, hồ sơ, quyết định và trạng thái **Chưa ký** tách biệt. Chưa tích hợp quy trình ký giấy hoặc dịch vụ tạo PDF phía server. Chưa xác nhận độ khớp bố cục với mẫu gốc bằng Kế toán.

Chứng từ sử dụng được chụp thành bản có bytes/hash; xóa file project không xóa bản trong hồ sơ. Quyết định, giao dịch và lịch sử được lưu riêng. Project có dữ liệu CostFlow không thể xóa qua thao tác xóa project thông thường.

## Kiểm tra và migration

Schema bổ sung sáu bảng, migration `20261002040000_costflow_standard_workflow`. Migration đã chạy trên **PostgreSQL 18 cục bộ riêng**, database `costflow_test`; chưa chạy trên database vận hành. Không đổi hoặc tự đọc credentials deployment.

```powershell
npm.cmd run test:costflow
# Kiểm tra tích hợp chỉ nhận database test riêng, localhost và tên costflow_test:
$env:COSTFLOW_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/costflow_test'
npm.cmd run test:costflow -- --integration
npx.cmd tsc --noEmit
npm.cmd run build:app
```

Kết quả: 6 unit tests + 1 suite tích hợp PostgreSQL, 0 lỗi/0 bỏ qua; TypeScript, ESLint các file thay đổi, Prisma validation/generation và build thành công. Bộ tích hợp kiểm tra quyền, dữ liệu đồng thời, tiền độc lập với duyệt, phiên bản người thụ hưởng, đối soát/đóng mở, lịch sử/chứng từ, số gốc/làm tròn và bảo toàn `Project.revenue`.

Trình duyệt đã kiểm tra đăng nhập, IC ba dòng 100,4 → tổng 301, lưu/reload, ba quyết định riêng và phiếu 12 triệu/10 triệu/2 triệu. Kiểm tra responsive có chiều rộng thực tế 434 px không tràn ngang; chưa khẳng định 390 px. Excel được đọc bằng openpyxl; trang in đã kiểm tra nội dung, chưa tự động xác nhận file PDF sau hộp thoại lưu.

## Phạm vi còn lại

### Phase 3 — PO và revision IC (2026-10-02)

Trong **Scope & Báo giá → Tài liệu dự án**, mở phần phiên bản PO: thêm PO, tạo bản sửa cùng số hoặc thay thế PO bằng số mới. Chọn bản hiện tại khi sửa/thay thế, chọn file nguồn và xác nhận thủ công số PO/giá trị VND. Tổng project chỉ tính bản hiện tại; bản cũ và nguồn bytes/hash được giữ. Chính sách PO ngoại tệ còn hoãn.

IC cho lưu nháp với giá vốn/VAT còn trống; trống không phải 0. Màn hình đánh dấu thiếu và chỉ tạm tính dòng đủ dữ liệu. Phải bổ sung trước khi gửi duyệt. Quy tắc này thay phần mô tả cũ “chặn VAT trống” khi lưu nháp; điều kiện gửi vẫn nghiêm ngặt. Brief/PO hoặc file nguồn project là đầu vào; không bắt buộc có PO để lập IC.

Mỗi project có một revision đang xử lý. Tiếp tục bản nháp hiện có; bản đã gửi cần rút với lý do trước khi tạo bản sửa. Chọn bản cũ trong cùng project để copy; không copy IC giữa project. Sửa thường giữ mã dòng, tách/gộp tạo mã mới và hiển thị nguồn gốc. Nhập rõ các dòng kết quả, không tự chia số lượng/chi phí. Bỏ dòng ở revision mới vẫn giữ AC, tiền và chứng từ thuộc revision/dòng cũ.

**So sánh revision IC** mặc định với bản hiệu lực, có thể chọn bản khác. Mọi trường nghiệp vụ hoặc nguồn thay đổi đều cần trình lại từ Quản lý dù tổng tiền không đổi. Ghi chú nội bộ riêng không sửa snapshot đã gửi. Hiệu lực ngân sách và trạng thái duyệt vẫn tách biệt; IC bị rút ngừng hiệu lực, không tự khôi phục IC trước.

Khi báo giá nguồn có bản mới, mở **Nguồn đã có bản mới** để xem và chọn hạng mục. IC không tự cập nhật. Giá vốn/VAT chi phí luôn giữ riêng; chỉ thay số lượng/đơn vị khi tick rõ từng trường. Dòng mới để trống giá vốn/VAT. Bản đã gửi được giữ bất biến và cần rút để sửa.

Kiểm chứng Phase 3: 11 unit tests, 15 tests với DB tích hợp, không lỗi/bỏ qua; TypeScript và lint đạt. Browser 390px/desktop đã kiểm tra nháp, split/merge, diff, rút/gửi lại và cập nhật báo giá chọn lọc. Direct Next build với output riêng và `build:app` đầy đủ đều đạt sau khi dừng server kiểm thử của phiên này. Bằng chứng nằm ở `.planning/phases/03-cf-02-project-po-v-ic-t-ng/03-IMPLEMENTATION-EVIDENCE.md` tại workspace root. Chưa nghiệm thu toàn Phase 3, nguồn thực tế/Kế toán/pilot hoặc production; O-01/O-02 tiếp tục hoãn.

Luồng Brief/PO → Scope & Báo giá → IC được người dùng chốt toàn bộ trong câu hỏi gộp ngày 2026-10-02. Báo giá nhập thủ công, giữ giá bán gốc, VAT rõ, dòng và phiên bản; nguồn file được snapshot bytes/hash trong kho evidence hiện có. Nguồn PO được tham chiếu đến bản lưu của PO. Sửa báo giá tạo phiên bản mới, không đổi bản cũ hoặc các dòng IC đã liên kết. Chọn hạng mục chuyển nội dung/số lượng/đơn vị sang IC; giá vốn và VAT chi phí để trống để nhập riêng. Server kiểm tra quyền Account/Admin, project, phiên bản dữ liệu, nguồn và trạng thái đóng tài chính. Không thêm vòng duyệt báo giá, không suy ra khách đã xác nhận PO hoặc thay doanh thu sales/IC hiệu lực. Dữ liệu dùng JSON workspace hiện có, tương thích các workspace chưa có collection báo giá, không có migration mới. Trang xuất chỉ cho người có quyền đọc toàn project; không phải tạo PDF phía server hoặc tự gửi khách hàng.

Clarification trực tiếp sau đó: **Brief và PO là đầu vào thay thế nhau, cùng cấp của project**. Danh sách/form nguồn và lựa chọn khi lập báo giá/IC đều hiển thị ngang hàng. Brief có tên và bản nguồn lưu bytes/hash; PO giữ số, bản nguồn và giá trị net vốn có. IC giữ cả tham chiếu Brief và PO khi có. Không bắt buộc thêm PO để đi tiếp từ Brief; không tự gán doanh thu PO cho Brief chưa có giá trị xác nhận. Kiểm tra tích hợp đã chạy case project chưa có PO: đăng ký Brief → lưu báo giá chỉ từ Brief → IC giữ Brief và không có PO.

Giao diện 2026-10-02: CostFlow nằm trong shell/Sidebar và điều hướng project của app; tổng quan hiển thị PO, IC hiệu lực, AC phát sinh, margin và hồ sơ gần đây. Nhập IC theo 3 bước Thông tin & nguồn → Hạng mục chi phí → Kiểm tra & lưu nháp, kèm tóm tắt từ helper tiền hiện có. Giữ dữ liệu khi chuyển bước, chặn VAT trống, giữ đơn giá gốc. Lưu thành công mới báo đã lưu; gửi duyệt riêng ở Hồ sơ & tiền. Liên kết từ Workflow mở tab Hồ sơ & tiền và cuộn đến hồ sơ. Prototype được dùng làm nguồn bố cục, không đổi nghiệp vụ/schema.

Đây là bản luồng chuẩn để kiểm tra cục bộ, chưa deploy hoặc nghiệm thu pilot đầy đủ. Ngoại lệ chi trước, điều chỉnh tiền đã trả, đối soát sai lệch nhỏ giữa thành phần làm tròn, nghiệm thu/thanh lý khách chuyên biệt, ký giấy, mẫu Workflow, lịch/nhắc việc và retention tiếp tục theo các phase tương ứng. Không có hành động ngoại lệ chi trước đang hoạt động. Bản casebook/source v1 còn chờ xác nhận chuyên môn; test xanh không thay xác nhận đó. Giữ nguyên roadmap 13 phase và không tự chuyển phase.

Clarification 2026-10-02: Brief/PO nguồn lấy trực tiếp từ tab Tài liệu của project TaskFlow. CostFlow hiển thị danh sách tài liệu gọn và chọn file trong trình lập báo giá/IC, không cần đăng ký nguồn lần nữa. Khi lưu, server kiểm tra file thuộc project và giữ bản chụp chứng cứ; IC từ báo giá kế thừa chứng cứ của báo giá. Nguồn đã đăng ký trước đây được giữ tương thích. Có tài liệu không tự xác nhận doanh thu PO; chính sách IC nháp chưa đủ nguồn vẫn giữ nguyên.

Clarification báo giá 2026-10-02: PO/Brief lưu hành nội bộ, bỏ phần chọn nguồn và yêu cầu nguồn của báo giá mới. Bản báo giá cũ/phiên bản kế tiếp giữ chứng cứ lịch sử. Tên mới mặc định theo project và có thể sửa; khách hàng chọn từ danh mục Client, mặc định khách hàng project, server lưu tên từ Client đã chọn. Không cập nhật Client của project khi lưu báo giá. IC vẫn dùng nguồn tài liệu nội bộ theo luồng hiện có.


## Phase 3.1 — Báo giá & IC song song (local implementation)

Scope & Báo giá có bảng chung theo hạng mục, giá bán/vốn và số lượng/VAT độc lập. Nháp có thể thiếu; Lưu nháp cập nhật hai phía trong một transaction, có lựa chọn chỉ lưu báo giá. Nhóm chọn giá gói hoặc chi tiết, giữ các giá đã nhập; ẩn dòng con trên báo giá khác thu gọn bảng. Khách nhìn thấy và bản in dùng cùng projection chỉ gồm dữ liệu bán; Xuất báo giá lưu một phiên bản trước khi mở bản in.

Minh chứng IC theo dòng hoặc nguồn toàn IC; một blob có thể gắn nhiều dòng. Tải từng file <=4MiB hoặc chụp tài liệu project; liên kết chỉ lưu với nháp. PNG/JPG/PDF hỗ trợ xem qua route có quyền, định dạng khác tải về. Mỗi dòng chi phí cần minh chứng hoặc lý do trước khi gửi. Bản đã gửi giữ lines/tree/source/hash; bổ sung là event riêng có người/thời điểm/dòng/phiên bản và chống ghi trùng khi thử lại. Điều chỉnh IC dùng revision mới theo quyền/rút hiện có; thay báo giá không tự sửa bản đã gửi.

Local verification và pending PDF/IME/pilot: workspace .planning/phases/03.1-bao-gia-ic-song-song/03.1-IMPLEMENTATION-EVIDENCE.md và 03.1-HUMAN-UAT.md. Không đồng nghĩa nghiệm thu toàn nghiệp vụ hoặc deployment.

### Excel Intake v4 — PAIR-21

Account/Admin có quyền tạo báo giá trong Project có thể tải **Tải mẫu Excel v4** tại `Scope & Báo giá`. Route tải là `/api/projects/[id]/costflow/excel-intake/template`; server xác thực lại tài khoản, vai trò và membership Project trước mỗi lần tạo file, trả XLSX ở chế độ `private, no-store`.

Workbook có sheet làm việc `BAO_GIA_IC`: metadata Project/khách hàng/thời gian/địa điểm ở đầu file, miền Báo giá màu xanh, miền IC màu vàng và ví dụ cây ba cấp. `_IMPORT` và `_META` ở trạng thái `veryHidden`; technical candidate key, parent và thứ tự do hệ thống sinh, không phải ID nghiệp vụ do người dùng nhập. Template không chứa bytes/ID minh chứng, credentials hoặc trạng thái duyệt, ngân sách, tiền, ký, thực hiện, doanh thu hay quyết toán.

Contract chuẩn là schema version `4`. Mỗi phía bán/mua giữ độc lập `quantity`, `days`, `unitPrice`, `basis` (`NET`/`GROSS`) và `vatPercent`; công thức dòng là `quantity × days × unitPrice`. Ô trống là chưa biết và khác số `0`. Số ngày/số lượng đã nhập phải lớn hơn 0; VAT từ 0 đến 100. Đơn giá `0` là FOC hợp lệ khi có ghi chú giải thích. `sell.days` không tự chép sang `buy.days`.

Công thức NET/VAT/GROSS và tổng trong Excel chỉ là preview. Mọi adapter/import sau này chỉ được nhận primitive allowlist kèm tọa độ nguồn, bỏ qua cached formula/total và tính lại bằng engine CostFlow phía server. Customer projection chỉ lấy allowlist phía bán; không bao gồm giá mua, NCC, ghi chú nội bộ, evidence hoặc metadata kỹ thuật.

Phạm vi của PAIR-21 dừng ở contract và template tải xuống. Plan này **không** parse file upload/paste, tạo hoặc ghi đè draft, round-trip stable ID, finalize, submit/approve, tác động budget/cash/revenue/settlement, hoặc xác nhận nghiệm thu công ty/Kế toán/production. Import mới thuộc Plans 10–11; kiểm thử file thật, native Vietnamese IME và pilot công ty tiếp tục Pending ở Phase 12.

## Nền phê duyệt dùng chung Phase 5

CostFlow dùng cùng sự kiện lần trình, khóa phiên bản/bước, yêu cầu xác nhận Kế toán, trả hồ sơ có danh sách nội dung cần sửa, gửi lại có phản hồi chung và thông báo bền vững như Workflow. Chuyển giao bước duyệt chỉ cho người đang hoạt động có cùng vai trò hợp lệ; người cũ đọc đúng hồ sơ/chứng từ được chuyển nhưng không thành project member và không có `fullAccess`. Chuyển giao xác nhận tiền vẫn là quyền riêng, không trộn với chuyển giao bước duyệt.

Các quy tắc tiền giữ nguyên: hiệu lực IC bắt đầu ở Quản lý; CEO trả/từ chối không tự thu hồi hiệu lực; rút IC mới ngừng hiệu lực; hủy hồ sơ không xóa giao dịch tiền hoặc khôi phục baseline cũ. Kiểm chứng DB/browser Phase 5 còn bị chặn theo ghi chú trong WORKFLOW.md.

## Khởi tạo báo giá từ template hoặc báo giá cũ — 2026-10-05

`Tạo báo giá` mở thư viện nguồn gồm tạo trống, template đang hoạt động và báo giá đã chốt thuộc project khác mà Account có quyền đọc. Thư viện dùng chung danh sách gần đây, tìm theo tên báo giá/project/khách hàng và lọc loại nguồn. Client chỉ gửi ID nguồn; server tự tải snapshot, kiểm tra quyền, loại nháp và loại project đích trước khi tạo draft.

Draft dùng lại sao chép toàn bộ projection phía khách gồm cây ba cấp, nội dung, cấu hình giá, giá bán, VAT, ghi chú và dòng tổng. Tên báo giá và khách hàng được đặt lại theo project đích. Brief, PO, file, minh chứng, IC, NCC, giá vốn và ghi chú nội bộ không được sao chép. Khi mở workspace song song, cây hạng mục được giữ nhưng toàn bộ trường mua để trống. Draft tạm giữ loại/ID nguồn để hiển thị cảnh báo; trước khi chốt phải xác nhận đã rà soát giá bán, VAT và dòng phí. Lưu nháp không bị chặn. Báo giá đã chốt có `parentId` rỗng và không giữ metadata nguồn.

Template báo giá là snapshot customer-safe bất biến, độc lập với Workflow template và không có chuỗi phiên bản. Account chỉ được đề xuất template từ báo giá đã chốt; Admin duyệt hoặc từ chối đề xuất, lưu trữ hoặc khôi phục template. Muốn thay nội dung phải công bố template độc lập mới. Template lưu trữ vẫn còn trong trang quản trị nhưng không xuất hiện trong thư viện tạo mới. Luồng tạo trống, tiếp tục nháp, revision cùng project và IC từ báo giá giữ nguyên; không cho sao chép IC xuyên project.

## Event Pricing Parameters — Phase 3.1 Wave 7

Template báo giá có thể định nghĩa `parameterConfig`: schema tham số, giá trị mặc định, các module event và công thức của từng phía bán/mua. Draft nhận bản sao độc lập; báo giá đã chốt, IC revision và submission giữ snapshot riêng. Template Teambuilding tham số dùng ID `quotation-template-teambuilding-parameters-v2`; template v1 cũ vẫn đọc được ở chế độ nhập tay.

Engine dùng AST có kiểu, không chạy chuỗi mã. MVP hỗ trợ tham số, hằng số, nhân, chia, làm tròn lên và làm tròn xuống. Dòng có trạng thái `MANUAL`, `PARAMETER`, `FORMULA` hoặc `OVERRIDDEN`. Dòng manual không bị tính lại; sửa trực tiếp một trường đã liên kết chuyển phía đó sang override và có thể chọn **Dùng lại công thức**. Giá bán và IC có binding, quantity và override độc lập; metadata không tự điền giá vốn, NCC hoặc bằng chứng.

Drawer **Thiết lập báo giá** gồm Thông tin chung, Người nhận, Tham số chương trình và Điều khoản thương mại. Thay đổi tham số chỉ tạo impact preview với dòng/trường và tổng cũ-mới. **Hủy thay đổi** giữ bảng hiện tại; **Áp dụng thay đổi** cập nhật editor khi fingerprint nguồn còn đúng. Thiếu tham số hoặc công thức lỗi vẫn cho lưu nháp, nhưng chặn chốt báo giá hoặc gửi IC ở phía bị ảnh hưởng.

Event type chỉ là gợi ý cấu hình. Một snapshot có thể chứa Teambuilding, Conference, Gala, Activation, Exhibition, Production hoặc module hỗn hợp; shared values có thể được override theo module. Customer projection/preview/print tiếp tục dùng allowlist bán và không serialize công thức, parameter metadata, giá vốn, NCC, evidence hoặc ghi chú nội bộ.

Kiểm chứng Wave 7: 50/50 unit, 58/58 full integration, TypeScript, focused ESLint và Next build đạt; browser local xác nhận template v2, preview/apply/cancel, override preservation, legacy manual mode, desktop và 390 px. Pilot công ty, PDF artifact thật và Vietnamese IME vẫn thuộc Human UAT.

## Phase 6 — hiệu lực IC và trình duyệt

Mỗi lần gửi IC bắt buộc có một lý do/tóm tắt chung. Snapshot đã gửi giữ nguyên nội dung dòng, cấu hình, nguồn, hash minh chứng, lời giải thích và ID baseline hiệu lực dùng để đối chiếu. Diff mặc định dùng đúng baseline hiệu lực; nếu chưa có baseline, giao diện nói rõ thay vì giả lập giá trị 0 hoặc “không thay đổi”. Bảng diff nhóm Thêm/Bỏ/Sửa, dùng nhãn nghiệp vụ và giá trị cũ/mới.

Quản lý là bước duy nhất kích hoạt baseline ngân sách. Cùng transaction lưu quyết định Quản lý, hệ thống chỉ giữ một revision hiệu lực, chuyển sang Kế toán và lưu ý định thông báo cho Kế toán. Kế toán và CEO vẫn quyết định riêng; cùng tài khoản giữ nhiều vai trò không được bỏ qua bước. Giao diện luôn tách `Hiệu lực ngân sách` khỏi `Kết quả trình duyệt`.

CEO trả hoặc từ chối IC được để trống ghi chú, nhưng ngoại lệ này chỉ áp dụng cho `COSTFLOW + IC + CEO`; Workflow và quyết định của Quản lý/Kế toán vẫn giữ yêu cầu lý do/nội dung sửa hiện có. CEO trả/từ chối không tự vô hiệu baseline, không cấp quyền thanh toán và lưu ý định thông báo đã khử trùng cho Account, Quản lý và Kế toán. Quản lý được ghi giải trình riêng vào lịch sử đúng request/revision mà không đổi kết quả CEO, hiệu lực, bước hoặc tiền.

CEO trả tạo đúng một revision nháp liên kết; bản CEO đã xem giữ nguyên và vẫn hiệu lực cho tới khi có rút/hủy/thay baseline rõ ràng. Rút hoặc hủy IC hiệu lực để project ở trạng thái không baseline, không khôi phục bản cũ. Phát sinh IC-dependent mới bị chặn; AC, tiền, chứng từ và lịch sử đã có vẫn được đọc/đối soát. Recovery dùng `Tạo revision từ IC-R{n}`, giữ liên kết/lý do và bắt đầu lại từ Quản lý, không gọi là restore.

## CostFlow UI refactor — 2026-10-07

Điều hướng CostFlow dùng tám tab theo thứ tự: Tổng quan, Scope & Báo giá, Internal Cost, Trình duyệt, Actual Cost, Hồ sơ & tiền, Quyết toán, Phân công. Query `?tab=requests` và `?tab=ic` vẫn tương thích; mọi deep-link `#request-{id}` mở Trình duyệt. Người không có full access chỉ thấy hồ sơ được giao tại screen này.

Scope & Báo giá là hub nguồn và phiên bản, không còn đồng thời là editor. Ba route báo giá, paired và IC dùng chung `CostFlowWorksheet` với mode `quote | paired | ic`; editor chuẩn tiếp tục sở hữu validation, parameter engine, immutable sales source, evidence và save/finalize. Hai route prototype `costflow-v2` và `costflow-v2-first` chỉ redirect về `costflow?tab=scope`.

Trình duyệt chỉ xử lý timeline, quyết định và evidence; Hồ sơ & tiền tạo request, quản lý người thụ hưởng, cash và phân bổ. Internal Cost luôn tách hiệu lực ngân sách khỏi kết quả approval; Actual Cost luôn tách approval khỏi giao dịch tiền. Không có thay đổi schema, payload server action, quyền, lifecycle hoặc công thức tài chính trong refactor này.

Local DB proof chỉ dùng `postgresql://postgres@127.0.0.1:55439/taskflow`; test từ chối host/port/database khác và xóa đúng fixture riêng. Hiệu lực IC không đồng nghĩa quyền thanh toán, tiền thực tế, chữ ký, hoàn tất công việc hoặc đóng tài chính. Nghiệm thu vai trò thật, đối soát Kế toán, delivery provider và production vẫn Pending.

## Số ngày trên dòng báo giá và IC — Phase 3.1 Wave 8

Dòng báo giá và IC dùng công thức `Số lượng × Số ngày × Đơn giá`; Expense/Actual Cost vẫn dùng công thức riêng hiện hữu. `Số ngày chương trình` trong Thiết lập báo giá chỉ là nguồn cho công thức của từng dòng, không phải hệ số nhân toàn báo giá.

Mỗi dòng giữ độc lập `Số ngày bán` và `Số ngày mua`. Dòng bán mới mặc định `1`; phía mua để trống và chỉ nhận ngày bán khi người dùng bấm **Dùng ngày bán**. Nháp được phép còn thiếu, nhưng chốt báo giá/gửi IC yêu cầu số ngày tương ứng lớn hơn 0. Dữ liệu cũ thiếu trường này được đọc với giá trị tương thích `1` trên dòng đã có giá, không sửa snapshot bất biến cũ.

Customer projection, preview và bản in chỉ xuất số ngày bán. Snapshot mới dùng `linePricingSchemaVersion: 2`; schema này độc lập với `parameterConfig.schemaVersion`.

## Phase 7 — ĐNTU đa khoản, tiền tạm ứng và sổ đối soát

Luồng vận hành chuẩn Phase 7 là một hồ sơ ADVANCE có nhiều khoản và nhiều người nhận, nhưng chỉ một milestone và một chuỗi duyệt toàn hồ sơ. Mỗi khoản giữ stable key, thứ tự, dòng/revision IC hiệu lực, người nhận và số VND nguyên dương; server tự tải lại nguồn/người nhận, tính tổng phiếu và tổng theo người nhận. `clientTotal`, role, recipient facts hoặc trạng thái gửi từ trình duyệt không có authority.

Khi hồ sơ bị trả, bản sửa là request mới liên kết bản nguồn. Snapshot cũ không đổi; diff theo stable key bao gồm header, thứ tự, nguồn, người nhận, số tiền và manifest tài liệu. Trao đổi gắn theo khoản chỉ bổ sung ngữ cảnh, không tạo quyết định. Kế toán kiểm tra tất cả NCC trong một lần; một NCC đổi phiên bản hoặc chưa xác minh làm cả hồ sơ bị trả.

Sau khi toàn hồ sơ ADVANCE được duyệt, chỉ Account/Admin đang hoạt động và được giao `cashAssigneeId` mới xác nhận tiền thật. Mỗi giao dịch chỉ thuộc một người nhận và chỉ phân bổ vào các khoản cùng Project/request/người nhận. Gross tạm ứng OUT có thể chia nhiều đợt; tạo/duyệt hồ sơ không tạo cash. Chứng từ được sao chép bytes/hash khi ghi giao dịch. Serializable transaction, optimistic workspace version, reference unique và fingerprinted idempotency ngăn retry/race ghi vượt trần.

Sổ đối soát chuẩn hóa tách riêng: kết quả duyệt, tiến độ cash, xác minh NCC, nguồn AC và đóng tài chính. Ledger không trả số tài khoản, bytes chứng từ hoặc suy luận provenance thiếu. Download/preview chứng từ recheck quyền đọc Project/hồ sơ, trả 404 không phân biệt và `private, no-store`.

UI dùng bảng desktop và card đầy đủ ở ≤767px cho editor, preview/reviewer và ledger. Preview trước submit nói rõ là projection tạm thời; server chuẩn hóa lại trước khi lưu snapshot bất biến. Reviewer có đúng một khu vực quyết định toàn hồ sơ. Tiền sau AC, hoàn IN, chi thêm OUT, approved actual và đóng tài chính không bị gộp vào tiến độ tạm ứng.

### Ranh giới hậu-AC và Phase 8

Phase 7 có contract tính selected-source, không FIFO: Account chọn rõ nguồn ứng và số áp dụng. Hai case 10m ứng / 8m actual → hoàn 2m và 10m / 12m → chi thêm 2m chỉ được chứng minh bằng fixture pure/test-only. Production `ApprovedActualCostConsumer` vẫn unavailable; đủ hóa đơn/chứng từ không đồng nghĩa AC đã duyệt. Vì vậy PAYMENT, ADVANCE_SETTLEMENT, refund IN và additional OUT thật vẫn fail closed, không có positive DB/browser claim trong Phase 7.

Contract producer chi tiết cho Phase 8 nằm tại `docs/COSTFLOW_PHASE8_AC_CONTRACT.md`. Phase 8 hoặc một gap plan sau Phase 8 phải cung cấp persisted approved AC, production binding, DB và authenticated browser proof trước khi mở các control này.

PAY-06 (ngoại lệ chi trước) được hoãn và vẫn Pending. Không có exception model/API/action/UI command. Kiểm chứng local Phase 7 không phải nghiệm thu Kế toán/công ty, pilot, deployment hoặc production acceptance.

Kiểm chứng Phase 7 dùng duy nhất PostgreSQL local `127.0.0.1:55439/taskflow` với URL guard và fixture riêng: policy/diff/read-model/security/UI contract, DB adversarial tests, TypeScript, focused ESLint và direct Next webpack build. Browser desktop/exact 390px là checkpoint riêng; mọi kết quả phải ghi rõ mức bằng chứng.

## Phase 8 — Nghiệm thu, Actual Cost và margin thực tế

Actual Cost chuẩn hóa theo dòng ổn định và nhiều occurrence/version bất biến. Mỗi version lưu `quantity × days × unitPrice`, NET/VAT/GROSS chính xác và một trong bốn nguồn: tạm ứng nhân sự, nhân sự ứng trước, tạm ứng NCC hoặc thanh toán NCC. Quantity chỉ có nghĩa trong đơn vị của dòng; UI và báo cáo không cộng quantity của các đơn vị khác nhau. IC là baseline so sánh bất biến, không bị AC viết lại.

Account/người có quyền Project có thể ghi AC khi chứng từ chưa đủ. Evidence Vault giữ hợp đồng/PO NCC, biên bản nghiệm thu-bàn giao, hóa đơn VAT, chứng từ thanh toán và ảnh/biên bản hiện trường dưới dạng snapshot có hash. Chỉ một `AC_DD` toàn công ty đang hoạt động được approve/return; DD có thể approve khi thiếu chứng từ chỉ sau acknowledgement rõ ràng, và warning vẫn tồn tại. Approval không tạo cash, không chứng minh đã trả, không hoàn tất settlement và không đóng tài chính.

Tab Actual Cost dùng một **Actual Cost Control Center** chung, nhưng server chỉ trả các lens actor được phép xem. Account/Admin xem worksheet theo loại chi phí và dòng IC: mỗi baseline IC mở ra mọi occurrence AC, gồm SL, ngày, ĐVT, đơn giá, NET, VAT, GROSS, variance, chứng từ, approval, application lock và tiến độ chi. Nhân sự thường chỉ nhận lens **Của tôi** với tạm ứng đã nhận, AC dùng tạm ứng, tiền tự chi, đã hoàn/chi thêm, số công ty còn phải trả và số nhân sự còn phải hoàn; không thể đổi filter để lấy người khác. `AC_DD` và Kế toán được phân công có lens **Bất thường & kiểm toán** toàn Project. Operations chỉ có lens **Theo NCC** khi Admin chọn họ trong danh sách thành viên đang hoạt động của đúng Project; phân công này không cấp quyền DD, Kế toán, xác nhận tiền hoặc đóng tài chính.

Một occurrence AC chỉ được tính một lần trong projection chuẩn rồi được tham chiếu bởi worksheet, nhân sự, NCC và audit. Tiền đã đề nghị/đã chi lấy từ payment request và normalized cash allocation; không nhận tổng tiền, vai trò hoặc trạng thái do browser gửi. Các trục DD approval, đủ chứng từ, hồ sơ được duyệt, tiền thực tế, settlement và financial close luôn hiển thị riêng.

Phase 7 chỉ tiêu thụ exact tuple `Project + stable AC line + immutable version + approval event + approval attempt`. Account chọn rõ advance line; không FIFO, không cross-Project/cross-recipient offset. Application đang active khóa resubmit/evidence mutation của AC; withdrawal hoặc cancellation hợp lệ mới release application, không sửa lịch sử cash. Bản ghi đồng thời dùng Serializable transaction, optimistic version và unique/idempotency constraints để một quyết định/application/receipt chỉ có một winner.

Thanh lý khách hàng là chuỗi version bất biến kèm số biên bản, ngày ký, NET, VAT, GROSS và chứng từ gốc. Doanh thu margin chọn theo thứ tự: NET thanh lý đã ký → NET báo giá finalized → NET PO hiện hành. `Margin thực tế = doanh thu NET được chọn - AC NET phát sinh`. AR cash-in là tiền khách đã thu theo mốc, reference và idempotency key; `Khách còn nợ = GROSS nguồn phải thu - tổng AR cash-in`. AR không cấp quyền chi tiền cho nhân sự/NCC và không thay đổi `Project.revenue` sales hiện hữu.

Customer Acceptance dùng dòng bán của báo giá finalized và actual quantity/days do Account nhập; không dùng quantity/giá mua của supplier làm customer actual. Phát sinh ngoài IC chỉ vào artifact khi đã DD approve, được đánh dấu billable và Account chọn exact current version. PDF/XLSX render cùng một snapshot allowlist, có contract/actual/delta và chữ ký hai bên; không xuất recipient/NCC, buy price, evidence ID/bytes, DD event, internal note hoặc margin.

Các trục vẫn độc lập: kết quả DD, completeness chứng từ, payment authorization, request lifecycle, actual cash, customer receipt, settlement, signature/execution và financial close. PAY-06 vẫn Pending. Không có bank integration, cross-Project offset, chữ ký số hoặc đồng bộ hóa đơn điện tử. Kiểm chứng local không phải nghiệm thu Kế toán/công ty, pilot, deployment hay production acceptance.
### Excel Intake v4 — nhập nháp mới (PAIR-22)

- `Dán bảng` và `Tải XLSX` dùng chung một normalizer, giữ tọa độ sheet/dòng/ô và tách lỗi chặn khỏi cảnh báo.
- Upload được kiểm tra chữ ký ZIP, giới hạn tài nguyên và nội dung chủ động trước khi ExcelJS đọc; công thức, macro, external link, DDE, OLE/ActiveX và sheet NCC/chứng từ không trở thành dữ liệu nghiệp vụ.
- Preview không ghi dữ liệu. Xác nhận yêu cầu Account/Admin hiện hành, Project membership, fingerprint, workspace CAS và idempotency key trong transaction Serializable; kết quả duy nhất là một paired draft mới với ID hệ thống.
- Import không finalize báo giá, không tạo/gửi/duyệt/làm hiệu lực IC và không đổi budget, cash, revenue hay settlement. Company pilot, native IME, accounting và production acceptance vẫn Pending cho Phase 12.

### Excel round-trip nháp Báo giá & IC — PAIR-23

- Chỉ nháp `paired` hiện tại, còn chỉnh sửa và thuộc Account/Admin đang hoạt động mới có thể xuất workbook round-trip nội bộ. Workbook giữ stable row/parent/order, Project, draft version và fingerprint trong sheet `veryHidden`; route dùng `private, no-store`, không chứa evidence bytes hoặc trạng thái approval/budget/cash/revenue/settlement.
- Re-import chạy cùng preflight ZIP/active-content của Excel Intake, đọc primitive phía bán/mua rồi tạo diff riêng cho thêm, thay đổi trường, di chuyển và dòng có thể xóa. Preview không ghi database; công thức trong ô dữ liệu, stable ID giả/trùng/chéo nháp, hierarchy lỗi và version/fingerprint cũ đều bị chặn.
- Dòng vắng khỏi workbook chỉ là deletion candidate. Mỗi dòng xóa mặc định chưa chọn và phải được người dùng xác nhận riêng; dòng không xác nhận được giữ nguyên. Apply re-authorize và kiểm tra workspace/draft CAS, preview fingerprint, selected deletions và lifecycle trong transaction Serializable; retry cùng payload là idempotent, race chỉ có một winner.
- Finalized quotation và IC đã submit/effective không bị round-trip sửa. Muốn đổi các bản đó phải dùng revision lifecycle hiện có. Customer quotation/PDF/XLSX vẫn dùng allowlist bán, không xuất buy, supplier, stable ID, draft version hay metadata round-trip.
- Phase 12 vẫn phải đo bằng file công ty thật: thời gian từ file đến nháp, số ô cần sửa và đối chiếu chênh lệch tổng. Test local/synthetic, browser local hay workbook reopen không phải nghiệm thu Kế toán, pilot công ty, deployment hoặc production acceptance.

## Excel Intake v4 — hợp đồng closure PAIR-21–23 (2026-10-26)

### Authority, exact value và lifecycle

- Workbook dùng mô hình hybrid: ô số hiển thị giữ trải nghiệm Excel quen thuộc, sheet `_IMPORT` giữ chuỗi thập phân canonical. Công thức chỉ để preview; server parse lại primitive, buộc chọn từng xung đột visible/canonical và tự tính authoritative totals. VAT `0` và đơn giá FOC `0` là giá trị hợp lệ; FOC vẫn cần ghi chú.
- Cả tạo nháp mới và round-trip chỉ nhận `previewSessionId` opaque. Canonical payload, actor, Project, operation kind, scope, draft/version, source hash và expiry nằm phía server. Browser projection không phải mutation authority.
- Preview thành công từ XLSX giữ bytes tạm trong session. Khi confirm/apply thành công, transaction tạo durable receipt và source evidence gồm bytes gốc, SHA-256, filename, MIME, size, actor, operation kind và linked record. Session `CONSUMED` xóa payload/bytes tạm nhưng còn review read-only qua receipt/evidence; receipt không bị eviction theo số lượng.
- Preview chưa dùng actionable đến trước `expiresAt` bảy ngày. Từ boundary hết hạn, confirm/apply fail closed và một transaction riêng ghi `EXPIRED`, xóa canonical/display payload cùng source bytes để lỗi nghiệp vụ sau đó không rollback việc redaction. `CANCELLED` và `SUPERSEDED` dùng cùng ranh giới non-actionable/redacted.
- Đổi file, paste, mode, sheet, range hoặc mapping phải cancel exact session trước khi cài source mới. Projection cũ chỉ còn dimmed/read-only. Response revision cũ bị bỏ; preview thành công mới nhất thắng theo actor + Project + operation scope, và round-trip thêm draft ID. Cancel A rồi B parse fail không làm A sống lại.

### Round-trip lossless và review

- Workbook round-trip giữ stable row/parent/order và canonical fingerprint trong sheet rất ẩn, nhưng apply chỉ tạo allowlisted patch trên server clone. Package/display state, formula binding, evidence, lineage, removal/lifecycle state và immutable quotation/revision không được lấy từ browser.
- Dòng thiếu khỏi workbook là deletion candidate mặc định unchecked. `Chọn tất cả` chỉ đổi selection; apply vẫn cần aggregate confirmation. Parent-only deletion bị chặn, không auto cascade/reparent.
- Server draft thay đổi sau preview làm toàn bộ apply stale và không ghi một phần. Người dùng giữ workbook, tải draft mới và rebuild diff; không có force overwrite.
- Technical/canonical metadata tamper chặn đúng stable row. Sửa một primitive có formula chỉ đặt đúng sell hoặc buy binding thành `OVERRIDDEN`; phía còn lại và protected state giữ nguyên.
- Upload MIME rỗng hoặc `application/octet-stream` chỉ được chấp nhận với tên `.xlsx` và package ZIP/OpenXML hợp lệ. Signature, content types, workbook/worksheet parts, path traversal, entry/ratio/size bounds, macro, external link, DDE, OLE/ActiveX và formula primitive vẫn fail closed.

### Ma trận finding/decision → behavioral evidence

| ID | Behavioral evidence đã chạy | Runner |
|---|---|---|
| CR-01, CR-05 | `public commands and browser callers use opaque preview sessions only`; `opaque new-draft session is atomic, durable and reviewable`; `live round-trip preview is authorized, zero-write and preserves immutable records` | integration |
| CR-02 | `allowlisted no-op preserves rich protected row state byte-for-byte`; `live apply keeps unconfirmed deletions, confirms selected deletion and enforces CAS replay race` | unit + integration |
| CR-03 | `hybrid decimals keep canonical exact values and emit stable per-cell conflicts`; `hybrid workbook keeps visible numerics and hidden exact canonical text for all eight primitives` | unit |
| CR-04 | `v4 normalization keeps exact coordinates, blank versus zero and independent sides`; `v4 workbook reopens with paired layout, three levels and preview-only formulas` | unit |
| CR-06 | `opaque new-draft session is atomic, durable and reviewable` thực thi replay sau 101 receipt | integration |
| CR-07 | `shared preview state stages source changes and isolates every revision`; `exact cancellation and newest-successful scope revoke stale authority` | unit + integration |
| WR-01 | `duplicate fields and decimal conflicts target their exact owning controls`; `normalization stamps every error and warning with row, field and source identity`; `round-trip row and aggregate diagnostics have deterministic distinct targets` | unit |
| WR-02 | `new-draft and round-trip parsing accept only safe XLSX filename and browser MIME variants`; `strict package preflight rejects missing parts, active content and excessive entries` | unit |
| WR-03 | Các suite trên gọi parser/workbook/reducer/service/DB thật; source-contract assertion chỉ bổ sung wiring, không đứng một mình làm closure | unit + integration |
| D-16–D-18 | Các test hybrid workbook, per-cell resolution, locale ambiguity và exact diagnostic ownership nêu trên | unit |
| D-19–D-21 | `authority schema contract is additive and keeps redaction payloads nullable`; `opaque new-draft session is atomic, durable and reviewable` kiểm tra bytes/hash/lineage, day-7/day-8, consumed review và 101 replay | integration |
| D-22–D-23 | `shared preview state stages source changes and isolates every revision`; `exact cancellation and newest-successful scope revoke stale authority` kiểm tra cancel-before-change, failed-B non-resurrection, late response và scoped supersession | unit + integration |
| D-24–D-26 | `one formula primitive edit overrides only its side and parent-only deletion is rejected`; `tampered hidden canonical binding blocks the affected stable row`; `live apply keeps unconfirmed deletions, confirms selected deletion and enforces CAS replay race` | unit + integration |

Runner chuẩn đăng ký và in inventory cho `excel-intake-authority-schema.integration.test.ts`, `excel-intake-authority.integration.test.ts` và `excel-round-trip.integration.test.ts`; fixture `phase31-gap-*` tự dọn và kiểm tra residue sessions/receipts/evidence/Projects/Users bằng `0`.

### Bằng chứng kỹ thuật local đã quan sát

- `npm.cmd run test:costflow`: PASS, 215/215 non-integration tests; gồm regression PAIR-01–20, customer privacy và các trục approval/budget/cash/revenue/settlement.
- Exact `DATABASE_URL` = `COSTFLOW_TEST_DATABASE_URL` = `postgresql://postgres@127.0.0.1:55439/costflow_test`, `EXCEL_AUTHORITY_SCHEMA_MODE=verify`, rồi `npm.cmd run test:costflow -- --integration`: PASS, 243 pass, 0 fail, 1 legacy skip có chủ đích; output có đủ ba suite persistence ở trên. Không select/mutate `/taskflow`, không seed/reset/repoint/db push/migrate deploy.
- `npx.cmd tsc --noEmit`: PASS. Targeted ESLint trên runner, Excel implementation/routes/dialogs và chín suite gap: PASS.
- `TASKFLOW_DIST_DIR=.codex-tmp/next-excel-gap-17-escalated` với direct Next 16 webpack build: PASS. Hai build sandbox ban đầu gặp Windows/OneDrive `EPERM` tại route động `[id]`; build cô lập cùng source chạy ngoài sandbox hoàn tất. Cảnh báo `unpdf` `import.meta` đã tồn tại, không làm build fail.

Đây chỉ là **automated local technical evidence**. Vẫn **Pending** và không được suy ra từ kết quả trên: exact-390px human visual interaction, native Vietnamese IME, real company workbook/accounting reconciliation, Phase 12 pilot, deployment và production acceptance. Không có browser acceptance, migration deploy hay production operation trong closure này.
