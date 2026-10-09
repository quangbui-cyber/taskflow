# myCreative UI Foundation v1

Trang xem mẫu: `/design-system`. Dùng dữ liệu giả lập; không cần DB, không ghi hồ sơ hoặc upload. Có thể truy cập trực tiếp để xem component, không đưa vào navigation nghiệp vụ.

## Nền tảng

Giữ nhận diện lime `#A8D431`, nền sáng và font hệ thống hỗ trợ tiếng Việt. Màu gốc ở `app/globals.css`; spacing, radius, typography, motion và các primitive ở `app/design-system.css`, được import sau globals trong root layout. Các lớp `tf-*` cũ tiếp tục dùng được.

| Token | Giá trị / cách dùng |
| --- | --- |
| `--space-1/2/3/4/5/6/8/12` | 4/8/12/16/20/24/32/48 px |
| `--radius-control/panel/dialog/pill` | 7/8/12/999 px |
| `--text-caption/label/body/heading/title` | 12/13/14/20/30 px |
| `--control-height` | 42 px; button chạm tối thiểu 44 px trên coarse pointer |
| `--text-secondary` | Nội dung hỗ trợ; không dùng lime làm chữ trên nền trắng |
| `--focus-ring` | Outline xanh đậm, dùng bàn phím vẫn nhìn rõ |
| `--duration-fast` | 160 ms; reduced motion kế thừa globals |
| `--info/success/warning/danger` | Ý nghĩa tương tác; mỗi trạng thái luôn có tên bằng chữ |

Chữ body 14 px, line-height 1.5; label/hint 13 px; title 30 px (28 trên mobile). Layout rộng tối đa 1220 px, mobile giữ padding 16 px. Số tiền căn phải, `tabular-nums`; đơn vị/currency hiện rõ. Không cộng các quantity khác đơn vị. UI không sở hữu rounding hoặc công thức tiền.

## Component API

Import từ file cụ thể để giữ ranh giới Server/Client nhỏ.

| Component | API / hành vi |
| --- | --- |
| `ui/Button` | `variant=primary/secondary/danger/ghost`, `size=sm/md/lg`, `loading`, `loadingLabel`; mặc định `type=button`, submit phải truyền tường minh; loading disable click |
| `ui/IconButton` | Bắt buộc `aria-label`; icon trang trí có `aria-hidden` |
| `ui/Field` | `Input`, `Select`, `Textarea`: bắt buộc label, optional hint/error; tự tạo id và gắn `aria-describedby`, giữ native name/type/required/ref/disabled/readOnly |
| `ui/Presentation` | `Badge` tone trung tính/thông tin/thành công/cảnh báo/lỗi; nội dung phải nêu trạng thái cụ thể |
| `Alert` | title bắt buộc, nội dung bổ sung; danger dùng alert, còn lại status; không thay thế lỗi từng trường |
| `Panel` | Surface + border + padding chuẩn; truyền children, không tự tạo heading |
| `EmptyState` | title, description, optional action; chỉ rõ bước tiếp theo có thể làm |
| `Table` | caption bắt buộc; children là thead/tbody native; th phải có scope; wrapper cuộn/focus, không giấu cột hoặc dùng hàng như nút |
| `ui/Dialog` | Controlled open/onClose/title/description/footer; native showModal giữ focus và làm nền inert; Escape/nút Đóng yêu cầu parent đổi open=false; focus ban đầu vào Đóng; không đóng khi click backdrop |

```tsx
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";

<Input name="title" label="Tên hồ sơ" required error={errors.title} />
<Button type="submit" loading={pending} loadingLabel="Đang lưu…">Lưu nháp</Button>
```

Field/Dialog dùng Client Components do cần useId/browser lifecycle. Button/Presentation không bắt buộc client boundary; callbacks từ Server Component vẫn phải qua Client Component theo Next. Ref dùng React 19 ref prop, không wrapper forwardRef. Native props được chuyển tiếp. className mở rộng layout; không ghi đè tone/variant bằng màu tùy ý. Không dùng Button thay Link. Không truyền type checkbox/radio vào Input có label dạng block; dùng native control với label phù hợp cho đến khi có primitive riêng.

## Trạng thái và pattern nghiệp vụ

Không suy ra quyền hành động từ màu, badge hoặc quyền đọc. Server là nguồn quyền. Một màn hồ sơ nên có: mã/phiên bản, trạng thái có tên, người đang xử lý, nội dung/file có nguồn, hành động đúng actor và lịch sử.

| Trục | Hướng hiển thị |
| --- | --- |
| Approval | Nháp / chờ đúng cấp / đã duyệt / trả / từ chối; từng quyết định riêng |
| Budget | IC có hiệu lực sau Quản lý; CEO trả/từ chối không tự vô hiệu |
| Cash | Ghi nhận giao dịch thực tế riêng; duyệt không đổi số đã trả |
| Signature | Chưa ký / đã ký kèm bản ký; duyệt không đồng nghĩa ký |
| Completion | Task DONE khác hoàn tất hồ sơ và đóng tài chính |

Timeline nghiệp vụ tương lai phải truy đúng actor/time/decision/version; gallery hiện chưa triển khai approval engine hoặc audit log. File UI phải phân biệt đã chọn, đang upload, đã lưu, lỗi; chỉ dùng “đã lưu” sau server xác nhận. Thiếu file/actor/chính sách vẫn cần nêu rõ, không biến mẫu thành business default.

## Adoption và kiểm tra

Login là luồng đầu tiên chuyển sang Input/Button/Alert; giữ auth action, name, autocomplete và validation. Các màn còn lại tiếp tục lớp cũ, chuyển dần khi có thay đổi ở màn đó. Không coi tất cả UI hiện có đã được migrate.

Khi thêm màn: kiểm tra label/help/error, loading chống click lặp, Tab/Shift+Tab/Escape và restore focus, disabled/readOnly, 390 px và desktop, overflow trong bảng, reduced motion và content tiếng Việt dài. Một primary action trong mỗi nhóm; danger phải nêu tên thao tác và dialog xác nhận khi thao tác có hậu quả.

Chưa có dark theme, combobox, pagination/sort server, file-upload primitive hay approval timeline hoàn chỉnh. Các phần này cần use case và policy riêng. Chất lượng runtime được ghi trong quick-task VERIFICATION.md; tài liệu này không phải bằng chứng production.

### CostFlow / Workflow adoption — 2026-10-02

Các trang CostFlow, hàng chờ và chi tiết Workflow dùng `ModuleShell` với Sidebar hiện có và danh sách project theo membership; quyền đọc/hành động vẫn kiểm tra tại server. `ProjectTabs` dùng chung cho Task/Tài liệu/Webhook/CostFlow. Trang in không bọc shell.

`app/modules.css` mở rộng Foundation v1 có phạm vi lớp riêng: header, tabs gạch chân, metric, bảng, workspace và tóm tắt. `ui/ModuleUI` dùng button native và số liệu do server cấp. Hàng chờ Workflow có tìm kiếm/lọc/phân trang client trên tập dữ liệu được phép đọc; chưa phải phân trang server.

Prototype `index.html` được giữ nguyên làm nguồn bố cục. Tái sử dụng thứ bậc project, dải quy trình, bảng chi phí, nhập IC theo bước và cột tóm tắt; màu/font theo app đã chốt. IC dùng 3 bước theo dữ liệu hiện hỗ trợ, không sao chép bước NCC/chứng từ chưa tồn tại trong IC, công tắc vai trò hoặc trạng thái demo. Bảng có vùng cuộn riêng ở màn hình hẹp; không giấu cột.


### Phase 3.1 worksheet adoption

PairedQuotationIcEditor dùng Foundation Panel/Table/Input/Select/Textarea/Button/Alert/Dialog. Worksheet song song hiện có 7 cột trong 3 nhóm, min-width 960px trên desktop; fieldset min-width 0. Mobile 390 hiển thị tên và hai tổng, còn panel Chi tiết giữ đầy đủ ĐVT, số lượng, giá và VAT; native modal evidence panel gắn phải desktop và nằm trong viewport hẹp. Collapse local tách khỏi flag xuất showChildren. Upload/selection/link/save/error có trạng thái chữ; customer preview dùng sales-only renderer. Actual keyboard/viewport checks và phần IME/PDF còn Pending ghi trong phase evidence ledger; gallery vẫn không phải xác nhận nghiệp vụ tài chính.

### Paired worksheet UX follow-up

Core sell/buy inputs stay in compact desktop table; row detail owns description,notes,NCC and tree operations. Evidence reachable next to item name. Sticky save bar shows totals, pending/error and unsaved state; explicit exit and native reload warn for unsaved edits. Sources follow worksheet. Quick261002-uir contains actual browser/DB evidence; this is not financial/pilot acceptance.

### Paired workspace accepted mockup — 2026-10-03
The paired quotation/IC editor now uses an open section. Its seven worksheet columns place unit before quantity, show exact net line totals and summarize net/VAT/gross below the table. Blue/orange colors emphasize group headings and totals, with neutral entry cells. VAT and supplementary fields use right-side native dialogs; quotation title/client/common notes live in the information drawer. Existing hierarchy, readonly IC locks, provenance and save scope remain. Fixed footer uses light totals, one save status, customer preview and primary draft save; finalization is in the Actions menu. Mobile shows item and both net totals with full entry through Details; no page overflow. Earlier compact eight-column layout is superseded.

### Paired workspace alignment follow-up — 2026-10-03

The editor header uses one compact hierarchy: module eyebrow, quotation title and list navigation, followed by a single customer summary strip and a consistent item toolbar. Worksheet headers, fields and money values share aligned padding and tabular number treatment. Customer and internal-cost bodies use very light blue/orange surfaces while group headings and totals retain the stronger semantic cues. At 390 px the context strip, actions and reduced three-column worksheet wrap without horizontal page overflow; full numeric editing remains in Details.

The desktop row uses joined unit/quantity controls with no floating separator. Unit price and a compact VAT basis/rate badge occupy one horizontal control cluster, and the pre-VAT amount shares that cluster's vertical center. This keeps the two sell/buy groups symmetrical and avoids detached helper text under only some inputs. Accessible field labels remain present but visually hidden in the worksheet.

### CostFlow quotation redesign — 2026-10-03
Scope/quotation composition, paired quotation/IC, and IC from an existing quote have dedicated project routes. New drafts and explicit resume links are distinct. The sales-only editor reuses the worksheet and detail drawer without creating an IC. The IC-from-quote mode keeps source sales immutable at the server and edits buying details through the right drawer. Three outline levels are offered for new hierarchy operations; legacy deeper data remains readable.

Quotation totals support percentage fees, fixed net fees with explicit VAT, and display-only intermediate totals. Each reference selects a source and net/VAT/gross basis. Display order does not determine calculation order. Exact arithmetic, reference-cycle validation, immutable finalized definitions, customer preview/print projection, and independent IC budgets are preserved. Local synthetic UI checks cover fee preview, IC drawer updates and 390px containment. DB persistence and company acceptance remain separate checks.
### Báo giá & IC — bảng nhập nhanh và panel Chi tiết

- Tên hạng mục trong bảng là điểm mở panel Chi tiết; chỉnh tên, mô tả và thuộc tính đầy đủ trong panel.
- Bảng song song giữ `ĐVT / SL bán`, đơn giá bán, giá vốn và hai thành tiền để quét nhanh theo hàng; ĐVT và số lượng mua nằm trong panel Chi tiết.
- Không hiển thị badge `Chưa VAT` / `Gồm VAT` cạnh đơn giá. Tỷ lệ VAT và cơ sở net/gross được chỉnh trong panel Chi tiết và vẫn tham gia đầy đủ vào phép tính tổng.

### Drawer Thiết lập báo giá và impact preview

- Trigger dùng nhãn **Thiết lập báo giá**. Drawer có bốn section theo thứ tự: Thông tin chung, Người nhận, Tham số chương trình, Điều khoản thương mại.
- Sửa metadata giữ proposed state riêng. Khi có thay đổi tính toán, hiển thị **Tác động dự kiến**, tổng bán/IC cũ-mới và từng hạng mục/phía/trường/cũ/mới trước hai hành động **Hủy thay đổi** và **Áp dụng thay đổi**.
- Trạng thái dòng liên kết dùng chữ rõ `Đã ghi đè` và hành động `Dùng lại công thức`; không dùng màu làm tín hiệu duy nhất.
- Ở 390 px, drawer chiếm vùng nhìn an toàn, form xếp một cột và mỗi impact row chuyển thành card dọc; document không tràn ngang. Desktop dùng bảng impact để so sánh nhanh.

### Scope & Báo giá — workspace và bản khách

- Tab `Scope & Báo giá` là hub tổng hợp Brief, PO, tệp dự án, báo giá hiện hành, nháp và lịch sử phiên bản. Hub là nơi khởi tạo/tiếp tục/mở/xuất/chốt phiên bản và lập IC; không nhúng editor vào danh sách.
- Mỗi hành động mở đúng `CostFlowWorksheet` toàn màn hình. Worksheet có ba mode `quote`, `paired`, `ic`; dùng chung hierarchy, drawer chi tiết, tổng, validation và hành vi lưu/chốt của editor chuẩn.
- Không nhúng bản khách hoặc bố cục print vào trang làm việc. Bản khách chỉ mở từ `Xem bản khách`; bản xuất nằm ở route `Xuất báo giá` riêng.
- Báo giá đã lưu vẫn là phiên bản nguồn bất biến. Chỉnh sửa tiếp tục qua draft/revision, không ghi đè lịch sử đã lưu.

### Worksheet — tên, mô tả và thành tiền

- `Tên hạng mục` và `Mô tả hạng mục` là hai cột riêng. Tên nhận diện dòng; mô tả hiển thị tối đa hai dòng và mở panel Chi tiết khi được chọn.
- Header số tiền dùng nhãn ngắn `Thành tiền`. Các dòng tổng bên dưới tiếp tục nêu rõ trước VAT, VAT và sau VAT để giữ đúng ngữ nghĩa tài chính.

### VAT mặc định

- Dòng Báo giá/IC mới mặc định VAT bán và VAT mua là `8%`, cơ sở giá là `Chưa VAT`.
- Đây là giá trị khởi tạo có thể sửa trong panel Chi tiết; `0%` và các mức VAT khác vẫn được giữ khi người dùng nhập rõ.

### Nhận diện hạng mục trong worksheet

- Tên hạng mục là điểm mở panel Chi tiết duy nhất; không lặp thêm nút `Chi tiết` dưới tên.
- Dòng gốc không hiện nhãn `Cấp 1 · Hạng mục`. Chỉ dòng con và nhóm mới hiện metadata phân cấp khi cần.
- Checkbox chọn dòng nằm ngay trước tên và chỉ xuất hiện khi có thể dùng cho thao tác hàng loạt. Minh chứng được quản lý trong panel Chi tiết, không lặp lại thành nút trên bảng.
- ĐVT và số lượng hiển thị thành một giá trị `ĐVT / SL` không viền để giữ hàng thẳng và dễ quét; bấm giá trị để chỉnh hai trường trong panel Chi tiết.

### Dòng tổng và thanh lưu của Báo giá & IC

- Ba dòng tổng hệ thống có công thức cố định nhưng cho phép đổi nhãn và sắp xếp cùng các dòng tính tiền bổ sung. Danh sách thống nhất trong card `Phí và phần tính tổng` là nơi duy nhất điều khiển thứ tự hiển thị trong worksheet và bản khách; không lặp thêm tiêu đề phụ bên trong.
- Mỗi hàng trong danh sách phải cho thấy tên, loại hệ thống/bổ sung, mô tả công thức và giá trị xem trước. Đổi tên thực hiện ngay tại hàng; sắp xếp hỗ trợ cả kéo thả và nút Lên/Xuống có nhãn truy cập.
- Dòng hệ thống không được xóa. Dòng bổ sung mở panel bên phải để chỉnh công thức và căn cứ `NET`/`VAT`/`GROSS`; không lặp lại thành thẻ cấu hình bên dưới danh sách.
- Giá trị chưa đủ dữ liệu hiển thị `Chưa đủ dữ liệu`, không thay bằng 0. Trên mobile, hàng được xếp lại theo chiều dọc và các vùng chạm đạt tối thiểu 44 px.
- Header thu gọn và danh sách các dòng thuộc cùng một card. Khi mở, danh sách nối ngay dưới header bằng đường phân cách nội bộ; không tách thành hai khối thị giác.
- Header dùng cỡ chữ compact như tiêu đề `Hạng mục`; help text mô tả thao tác, còn thu gọn/mở rộng dùng nút icon chevron có nhãn truy cập.
- Toàn bộ header là một disclosure target: bấm vào bất kỳ vị trí nào để mở/thu gọn. Help text nêu mục đích, thao tác có thể làm và cách mở nội dung.
- Các dòng tổng trong worksheet không có hàng nhãn `TỔNG TIỀN` riêng và cùng dùng màu xanh lá mạ `--primary` của logo với chữ tối đủ tương phản.
- Ba dòng chuẩn dùng pill `Mặc định`. Hành động `Thiết lập` mở mô tả nguồn dữ liệu, phép tính và giá trị hiện tại; công thức net/VAT/gross vẫn là chuẩn hệ thống để không làm đổi ngữ nghĩa tổng báo giá. Tên hiển thị và thứ tự vẫn tùy chỉnh được.
- Thanh lưu chỉ giữ ba số tổng, tùy chọn `Kèm IC` và các hành động `Xem bản khách`, `Lưu nháp`, `Khác`; trạng thái đang lưu nằm ngay trên nút lưu, không lặp thành pill riêng.
- Hành động minh chứng dùng nhãn `Minh chứng chung`; không dùng nhãn kỹ thuật khó hiểu như `Nguồn toàn IC`.

### Điểm vào Báo giá & IC song song

- `Scope & Báo giá` chỉ khởi tạo và tiếp tục nháp báo giá khách độc lập.
- `Internal Cost` hiển thị trực tiếp trình nhập IC từ báo giá mới nhất khi project chưa có IC. Giá bán và cấu trúc hạng mục là nguồn chỉ đọc; giá vốn, VAT mua, NCC, ghi chú và minh chứng được chỉnh trong panel chi tiết.
- `Mở Báo giá & IC song song` dẫn sang workspace toàn màn hình để chỉnh đồng thời giá bán và giá vốn. `Tạo IC độc lập` giữ luồng riêng cho trường hợp không dùng báo giá nguồn.
- Khi project đã có báo giá, `Mở Báo giá & IC song song` phải mở từ báo giá mới nhất và nạp toàn bộ hạng mục đã lưu. Chỉ mở worksheet trống khi project chưa có báo giá; nháp đang làm luôn giữ nguồn riêng của nháp.
- `Lập IC từ báo giá` vẫn bắt đầu từ phiên bản báo giá đã lưu để người dùng chọn đúng nguồn.
- Workspace song song kế thừa cấu trúc thị giác của worksheet báo giá: hàng nhóm là một dải xanh nhạt duy nhất, các cấp dùng cùng số thứ tự và nhịp hàng, còn tổng cuối bảng dùng dải xanh lá mạ. Màu xanh dương/cam chỉ định hướng hai miền Báo giá/IC ở header và nhãn; không tô nền toàn bộ ô dữ liệu.
- Hàng nhóm không giả lập ô nhập bán/mua. Dải nhóm chỉ hiển thị tên nhóm, số hạng mục và tổng Báo giá/IC; chỉnh cấu hình nhóm vẫn mở từ tên nhóm.
- Trên màn hình hẹp, bảng song song giữ ba cột nhận diện hạng mục, tổng Báo giá và tổng IC. Các trường ĐVT, số lượng và đơn giá tiếp tục chỉnh qua panel Chi tiết.

### Liên kết Báo giá → IC và quyền chỉnh sửa — 2026-10-06

- Ba workspace dùng cùng dải liên kết để chỉ rõ bản Báo giá hiện tại/nguồn, IC revision và trạng thái hồ sơ. Nếu Báo giá có phiên bản mới hơn nguồn của IC, giao diện phải cảnh báo và dẫn về `Internal Cost`; không tự đổi nguồn hoặc hiệu lực IC.
- Phiên bản Báo giá trong dải liên kết hiển thị cả ngày tạo để người dùng nhận diện đúng nguồn. Khi IC bị khóa, cả dải liên kết và tiêu đề cột IC phải ghi rõ `Chỉ đọc` thay vì chỉ vô hiệu hóa control.
- `Tạo Báo giá` chỉ sửa phía bán và cấu trúc. Từ một nháp Báo giá đã lưu, `Thêm IC song song` tạo một nháp `Báo giá & IC` riêng, sao chép phía bán nhưng khởi tạo trống toàn bộ giá vốn, NCC, minh chứng và liên kết IC.
- `Báo giá & IC` cho phép thêm nhóm/hạng mục, chèn theo ngữ cảnh, kéo thả cấu trúc và sửa cả hai phía. Thanh lưu phải nêu rõ scope `Báo giá & IC` hoặc `Chỉ Báo giá`; khi chọn chỉ Báo giá mà đã nhập dữ liệu mua, phải cảnh báo dữ liệu IC không được lưu trong lần đó.
- `IC từ Báo giá` khóa phía bán và cấu trúc, chỉ mở giá vốn, VAT mua, NCC, ghi chú và minh chứng trong panel Chi tiết. Điều hướng Dòng trước/Dòng sau cho phép rà tuần tự mà không quay lại bảng.
- Trong bảng song song, Enter tại ô đơn giá bán hoặc giá vốn chuyển đến dòng kế tiếp cùng cột. Panel Chi tiết giữ số thứ tự dòng trong tiêu đề sticky và hiển thị riêng mức hoàn thiện của Báo giá (`x/6`) và IC (`x/7`, gồm minh chứng hoặc lý do chưa có nguồn); giá trị `0` của đơn giá vẫn được coi là đã nhập.
- `Số ngày bán` và `Số ngày mua` là hai input độc lập trong panel Chi tiết, đặt giữa Số lượng và Đơn giá. Phía mua có action rõ ràng `Dùng ngày bán`; không tự sao chép ngầm. Bản khách hiển thị cột Số ngày giữa SL và Đơn giá.
- Khu vực tùy chỉnh tổng ở workspace song song dùng nhãn chính xác `Phí và tổng của báo giá khách`; không ngụ ý các dòng phí này đồng thời sửa tổng IC.
- Workspace toàn màn hình của Báo giá và Báo giá & IC hiển thị trực tiếp `Chốt phiên bản BG`. Sau khi lưu thành công, giao diện đưa ra bước tiếp theo tới `Internal Cost` và `Trình duyệt`; lưu/chốt Báo giá không đồng nghĩa gửi duyệt IC.
- Tên nút theo đối tượng và trạng thái: `Soạn Báo giá & IC`, `Lập IC từ BG-{số}`, `Sửa IC-R{n}` cho nháp của chính người lập và `Tạo revision từ IC-R{n}` cho bản đã gửi/hiệu lực.

### Scope & Báo giá — giảm mật độ thao tác

- Thanh đầu hub giữ `Tài liệu dự án` và `Tạo báo giá mới`; báo giá hiện hành, nháp và lịch sử là ba vùng độc lập.
- Các hành động `Tiếp tục nháp`, `Mở Worksheet`, `Xem bản khách`, `Xuất báo giá`, `Lập IC từ bản này` luôn gắn với đúng draft/version đang hiển thị.
- Worksheet chỉ hiển thị action của version đang mở. Khi quay về Scope với thay đổi chưa lưu, editor phải dùng unsaved guard hiện có.
- Drawer Thiết lập giữ metadata trong draft riêng với `Lưu thiết lập`; thay đổi tham số phải qua `Xem tác động` rồi `Áp dụng thay đổi`. Đóng hoặc hủy không làm rò thay đổi chưa áp dụng vào worksheet.

### CostFlow tabs và screen lifecycle

- Thứ tự chuẩn: `Tổng quan → Scope & Báo giá → Internal Cost → Trình duyệt → Actual Cost → Hồ sơ & tiền → Quyết toán → Phân công`.
- `Trình duyệt` tổng hợp mọi approval CostFlow (IC, tạm ứng, thanh toán NCC, hoàn tạm ứng, sửa AC, hủy, đóng/mở). Tạo hồ sơ vẫn nằm ở tab nghiệp vụ nguồn; deep-link `#request-{id}` mở tab Trình duyệt.
- `Hồ sơ & tiền` sở hữu form tạo request, người thụ hưởng, giao dịch cash và phân bổ. Approval không được suy ra là đã chi tiền.
- Desktop ưu tiên bảng cho IC, AC, giao dịch và đối soát; mobile chuyển sang card/detail hoặc drawer, không làm mất action hay trường nhập.

### Thư viện nguồn báo giá

- Màn chọn nguồn dùng Foundation Panel, Input, Select, Button và Alert; ba cách khởi tạo là các lựa chọn ngang hàng.
- Danh sách mặc định theo gần đây, có tìm kiếm và lọc loại. Mỗi kết quả chỉ hiển thị tên báo giá, project, khách hàng và thời điểm; không đưa metadata nội bộ hoặc IC ra client.
- Hai hành động đích `Tạo báo giá` và `Tạo Báo giá & IC` nằm ngay trên mỗi nguồn. Trên mobile, card và hành động xếp dọc, không tạo tràn ngang trang.
- Draft dùng lại hiển thị cảnh báo giá cũ và checkbox xác nhận trước khi chốt. Checkbox không cản lưu nháp và không thay trạng thái approval/IC.
- Trang Admin dùng cùng pattern danh sách trạng thái cho hàng chờ đề xuất, template hoạt động và template lưu trữ; hành động công bố, từ chối, lưu trữ hoặc khôi phục luôn có nhãn chữ.

### Polish worksheet Báo giá & IC — 2026-10-06

- Control chèn dòng nằm trong grid riêng của bảng song song; không kế thừa vị trí tuyệt đối từ worksheet Báo giá. Tên nhóm và tên hạng mục được ưu tiên chiều rộng và xuống dòng, không thay đổi dữ liệu tên/mô tả.
- Tổng nhóm tách nhãn và số tiền thành hai dòng, căn phải và dùng tabular numbers. Trên mobile, hai tổng chia đều chiều rộng dưới tên nhóm.
- Desktop hẹp cuộn ngang trong vùng bảng và ghim cột tên hạng mục; mobile giữ ba cột nhận diện / Báo giá / IC và đưa tên hạng mục xuống hàng riêng trong ô nhận diện.
- Thanh lưu của workspace song song dùng hai hàng: tổng trước, phạm vi lưu và hành động sau. Chưa nhập vẫn khác 0; việc polish không đổi công thức, phiên bản hoặc vòng duyệt.
- Miền IC trong bảng song song chỉ giữ `Giá vốn` và `Thành tiền`. Giá vốn vẫn nhập trực tiếp; nút mũi tên cạnh input và toàn bộ thành tiền IC mở đúng dòng trong panel Chi tiết.
- Khi mở từ miền IC, panel tự cuộn có khoảng bù dưới header cố định tới tiêu đề `IC nội bộ` và focus `ĐVT mua`. Đổi dòng bằng `Dòng trước` / `Dòng sau` giữ cùng đích IC.
