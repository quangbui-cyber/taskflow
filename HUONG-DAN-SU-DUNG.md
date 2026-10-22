# Hướng dẫn sử dụng TaskFlow

Tài liệu này dành cho người dùng cuối của TaskFlow (myCreative), bao gồm nhân viên, Account, người quản lý và Admin.

- Địa chỉ sử dụng: [https://mycreative.vercel.app](https://mycreative.vercel.app)
- Ứng dụng không có chức năng tự đăng ký. Tài khoản do Admin cấp.
- Giao diện dùng được trên máy tính và điện thoại. Trên điện thoại, bấm nút menu ở góc trên bên phải để mở thanh điều hướng.

## 1. Vai trò và quyền hạn

| Chức năng | `USER` | `ACCOUNT` | `ADMIN` |
| --- | :---: | :---: | :---: |
| Xem dự án mình tham gia | Có | Có | Có |
| Tạo, sửa và cập nhật task trong dự án | Có | Có | Có |
| Tạo dự án | Có | Có | Có |
| Xem doanh số | Không | Dự án mình tham gia | Toàn công ty |
| Xem hiệu suất cá nhân | Có | Có | Có |
| Xem nhân viên trực tiếp | Khi được gán làm quản lý | Khi được gán làm quản lý | Toàn bộ nhân viên |
| Quản trị tài khoản và danh mục | Không | Không | Có |

Một số quyền phụ thuộc vai trò trong từng dự án:

- **Chủ dự án:** sửa thông tin, đổi trạng thái, cấu hình Google Chat, xóa thành viên khác và xóa dự án.
- **Thành viên:** tạo/cập nhật task, bình luận, thêm thành viên hoặc nhóm, quản lý tài liệu mình tải lên và tự rời dự án.
- **Admin:** có thể xem và quản lý mọi dự án; tuy nhiên chỉ chủ dự án mới được xóa cả dự án.

## 2. Đăng nhập và đăng xuất

### Đăng nhập

1. Mở [https://mycreative.vercel.app](https://mycreative.vercel.app).
2. Nhập email và mật khẩu do Admin cung cấp.
3. Bấm **Đăng nhập**.

Nếu nhập sai quá nhiều lần, hệ thống sẽ tạm khóa đăng nhập để bảo vệ tài khoản. Hãy chờ theo thời gian hiển thị trên màn hình rồi thử lại. Nếu quên mật khẩu hoặc tài khoản bị vô hiệu hóa, liên hệ Admin.

### Đăng xuất

Bấm biểu tượng đăng xuất cạnh tên tài khoản ở cuối thanh bên. Trên điện thoại, mở menu rồi bấm biểu tượng đăng xuất ở cuối menu.

## 3. Thanh điều hướng

Các mục chính gồm:

- **Công việc:** dashboard công việc và dự án của bạn.
- **Thông báo:** cập nhật về giao việc, bình luận, theo dõi và hạn chót.
- **Hiệu suất:** thống kê công việc cá nhân hoặc nhân viên.
- **Doanh số:** chỉ hiển thị cho `ACCOUNT` và `ADMIN`.
- **Dự án:** danh sách dự án đang hoạt động, được nhóm theo Team/phòng ban phụ trách. Team kinh doanh có hai mục con **Khách hàng** và **Nội bộ**; các **Phòng ban / Nhóm** chỉ có mục **Nội bộ**. Các mục có số lượng dự án và có thể mở hoặc thu gọn. Dự án Khách hàng tự xếp theo Team của Account; dự án Nội bộ chưa chọn nhóm phụ trách nằm trong **Chưa gán Team**. Dự án Khách hàng cũ thiếu Account nằm trong **Cần gán Account**. Các nhóm trạng thái trong **Lưu trữ** cũng được chia theo hai loại này.
- **Lưu trữ:** các dự án `Done`, `Fail`, `Cancel` hoặc `Pending`.
- **Cài đặt:** chỉ hiển thị cho `ADMIN`.

## 4. Dashboard Công việc

Dashboard giúp xử lý công việc hằng ngày mà không cần mở từng dự án.

### Các chế độ xem

- **Tổng quan:** việc ưu tiên hôm nay, việc còn lại của bạn và việc bạn đã giao.
- **Của tôi:** toàn bộ task chưa hoàn thành đang giao cho bạn.
- **Đã giao:** task bạn tạo và giao cho người khác.
- **Đang theo dõi:** task bạn theo dõi nhưng không trực tiếp làm hoặc giao.
- **Nhân viên của tôi:** chỉ xuất hiện nếu Admin đã gán nhân viên trực tiếp cho bạn; hiển thị báo cáo công việc của từng người.

Bạn có thể sắp xếp task theo **hạn chót** hoặc **dự án**. Bấm một task để mở thẳng chi tiết task trong dự án tương ứng.

### Nhắc việc ưu tiên

Khu vực ưu tiên hiển thị:

- Task đã quá hạn.
- Task sắp đến hạn trong 3 ngày.
- Các task còn lại của bạn.

### Danh sách dự án

- Dự án `On Process` và `Bidding` xuất hiện trong nhóm đang hoạt động.
- Dự án `Done`, `Fail`, `Cancel` và `Pending` được chuyển vào **Lưu trữ**.
- Bấm tên dự án để mở bảng công việc.
- Mọi người dùng có thể bấm dấu **+** cạnh tiêu đề Dự án để tạo dự án mới.

## 5. Tạo dự án

Mọi người dùng đang hoạt động đều có thể tạo dự án Nội bộ hoặc Khách hàng. Quyền tạo/sở hữu dự án không cấp quyền xem hoặc sửa doanh thu.

### Tạo thủ công

1. Bấm dấu **+** cạnh mục Dự án hoặc mở **Tạo dự án mới**.
2. Ở màn hình lựa chọn, bấm **Nội bộ** hoặc **Khách hàng** để mở form riêng. Có thể bấm **Chọn lại loại dự án** để quay lại.
3. Nhập tên và mô tả nếu cần. Dự án Khách hàng có thêm **Loại hình**: Teambuilding, MICE, Activation, Event, Pur hoặc Other; dự án Nội bộ không cần chọn loại hình.
4. Với dự án Khách hàng, bắt buộc chọn **Account phụ trách**; **Team kinh doanh** tự hiển thị theo Account và không chọn riêng. Chọn Client nếu cần. Với dự án Nội bộ, chọn **Team/phòng ban phụ trách** nếu cần.
5. Điền ngày bắt đầu, ngày kết thúc nếu dự án chạy nhiều ngày.
6. Với dự án Khách hàng, Admin/Account có thể nhập doanh thu dự kiến bằng VND.
7. Bấm **Tạo dự án**.

Dự án Khách hàng tạo thủ công bắt đầu ở `Bidding`. Dự án Nội bộ bắt đầu ở `On Process`, không dùng Client/Account/PO và không tính vào doanh số. Dự án cũ mặc định là Khách hàng. Người tạo trở thành chủ dự án. Nếu chọn Account, người dùng gắn với Account đó cũng được thêm vào dự án.

### Tạo dự án từ PO PDF

Chỉ Admin/Account được nhập PO, cho dự án có mục đích Khách hàng.

1. Trong màn hình tạo dự án, bấm **Nhập PO PDF**.
2. Chọn PO PDF của Jabil, dung lượng dưới 4 MB.
3. Kiểm tra dữ liệu được tự điền: số PO, tên dự án, Client, mô tả và giá trị.
4. Nếu hệ thống chưa ghép đúng Client, chọn lại thủ công.
5. Hoàn thiện loại hình, Account và ngày thực hiện rồi bấm **Tạo dự án**.

Khi tạo từ PO Jabil:

- Trạng thái ban đầu là `On Process`.
- File PO được tự động lưu trong tab **Tài liệu**.
- Hệ thống chặn tạo trùng một số PO đã tồn tại.

## 6. Thông tin và trạng thái dự án

Phần đầu trang dự án hiển thị mục đích Nội bộ/Khách hàng, trạng thái, loại hình, lịch thực hiện, Client, Account, số PO, doanh thu và thành viên. Doanh thu chỉ hiển thị cho `ACCOUNT` và `ADMIN`.

Dự án Khách hàng luôn xếp theo Team của Account: đổi Account hoặc đổi Team của Account sẽ cập nhật nhóm dự án trên thanh bên và báo cáo doanh số. Dự án cũ thiếu Account được đánh dấu **Cần gán Account** và phải chọn Account trước khi lưu thông tin. Dự án Nội bộ chọn nhóm phụ trách riêng; gán nhóm không tự thêm thành viên.

### Ý nghĩa trạng thái

| Trạng thái | Cách sử dụng |
| --- | --- |
| `Bidding` | Cơ hội đang chào giá hoặc chưa chốt |
| `On Process` | Dự án đã thắng và đang triển khai |
| `Done` | Dự án đã hoàn thành |
| `Fail` | Không thắng dự án |
| `Pending` | Dự án tạm dừng hoặc chờ xử lý |
| `Cancel` | Dự án bị hủy |

Chỉ chủ dự án hoặc Admin có thể đổi trạng thái. Việc chuyển sang `On Process` hoặc `Done` ảnh hưởng đến báo cáo doanh số, vì vậy cần cập nhật đúng thời điểm.

### Sửa thông tin dự án

Chủ dự án hoặc Admin bấm biểu tượng **Sửa** cạnh tên dự án để cập nhật:

- Tên và mô tả.
- Team/phòng ban phụ trách: chọn từ **Team kinh doanh** hoặc **Phòng ban / Nhóm** đã tạo trong Cài đặt; chỉ áp dụng cho Nội bộ. Chọn **Chưa gán** để bỏ nhóm phụ trách.
- Loại hình (chỉ dự án Khách hàng).
- Ngày thực hiện.
- Mục đích Nội bộ/Khách hàng (dự án có PO giữ mục đích Khách hàng).
- Doanh thu: chỉ Admin/Account, với dự án Khách hàng.
- Client và Account: với dự án Khách hàng, Account bắt buộc và Team tự cập nhật theo Account. Account mới được thêm vào thành viên dự án; Account cũ vẫn có thể tiếp tục tham gia.

Chuyển sang Nội bộ xoá Client, Account và doanh thu. USER không được chuyển dự án đang có doanh thu; cần liên hệ Admin hoặc Account.

Bấm **Lưu thay đổi** để xác nhận.

### Xóa dự án

Chỉ chủ dự án có thể xóa dự án. Mở menu **Thao tác khác**, chọn xóa và xác nhận. Thao tác này xóa cả task, bình luận, tài liệu và dữ liệu liên quan, nên chỉ thực hiện khi chắc chắn.

## 7. Quản lý thành viên dự án

1. Bấm cụm avatar hoặc số thành viên ở đầu trang dự án.
2. Tìm người dùng bằng tên hoặc email.
3. Chọn đúng tài khoản rồi bấm **Mời**.

Để thêm nhiều người cùng lúc:

1. Mở danh sách thành viên.
2. Ở mục **Thêm phòng ban / nhóm**, chọn một nhóm.
3. Bấm **Thêm nhóm**.

Lưu ý:

- Người được thêm phải có tài khoản đang hoạt động.
- Bất kỳ thành viên nào trong dự án cũng có thể thêm người hoặc nhóm.
- Chủ dự án có thể xóa thành viên khác.
- Thành viên có thể tự rời dự án.
- Không thể xóa chủ dự án khỏi dự án.
- Khi một người rời dự án, task đang giao cho họ trở thành chưa gán và họ không còn theo dõi task trong dự án đó.

## 8. Quản lý task bằng bảng Kanban

Tab **Task** có ba cột:

- **Cần làm**
- **Đang làm**
- **Hoàn thành**

### Tạo task

1. Bấm **Thêm task** ở cột phù hợp.
2. Nhập tên task.
3. Chọn người làm, độ ưu tiên và hạn chót nếu cần.
4. Có thể thêm mô tả và kết quả/bàn giao.
5. Bấm nút tạo để lưu.

Chỉ có thể giao task cho thành viên của dự án. Hạn chót hỗ trợ ngày, giờ và phút theo mốc `00` hoặc `30` phút.

### Di chuyển task

Kéo thả task:

- Sang cột khác để đổi trạng thái.
- Lên hoặc xuống trong cùng cột để đổi thứ tự.

Trên điện thoại, dùng các nút tên cột ở đầu bảng để chuyển nhanh giữa ba cột.

### Chỉnh sửa chi tiết task

Bấm vào một task để mở cửa sổ chi tiết. Bạn có thể cập nhật:

- Tên task.
- Trạng thái và độ ưu tiên.
- Người làm.
- Hạn chót.
- Mô tả công việc.
- Kết quả hoặc thông tin bàn giao.
- Người theo dõi.
- Bình luận.

Bấm **Lưu thay đổi** sau khi chỉnh sửa. Khi task chuyển sang **Hoàn thành**, hệ thống ghi nhận thời điểm hoàn thành để tính đúng hạn hoặc trễ hạn.

### Theo dõi task

- Bấm **Theo dõi** để tự nhận cập nhật về task.
- Bấm **+ Thêm người theo dõi** để thêm thành viên khác.
- Có thể bỏ theo dõi bằng dấu **×** cạnh tên người theo dõi.

Người theo dõi nhận thông báo khi trạng thái, người phụ trách hoặc hạn chót thay đổi, khi có bình luận mới và khi task hoàn thành.

### Bình luận và xóa task

- Nhập nội dung ở cuối cửa sổ task rồi bấm gửi để bình luận.
- Bấm **Xóa task** và xác nhận nếu muốn xóa.

Mọi thành viên dự án đều có thể cập nhật hoặc xóa task, vì vậy cần kiểm tra đúng task trước khi xóa.

## 9. Tài liệu dự án

Mở dự án và chọn tab **Tài liệu**.

### Tải tài liệu lên

1. Bấm **Tải tài liệu**.
2. Chọn file.
3. Chờ thông báo tải lên thành công.

Hệ thống hỗ trợ PDF, JPG, PNG, WebP, Word, Excel, PowerPoint, TXT và CSV. Mỗi file tối đa 4 MB.

### Tải xuống hoặc xóa

- Bấm biểu tượng tải xuống cạnh file để lưu về máy.
- Người tải file lên có thể xóa file của mình.
- Chủ dự án và Admin có thể xóa mọi file trong dự án.
- Thành viên khác chỉ được xem và tải xuống.

## 10. Thông báo

Biểu tượng hoặc mục **Thông báo** hiển thị số lượng chưa đọc. Bạn có thể lọc:

- **Tất cả:** thông báo trong 7 ngày gần nhất.
- **Chưa đọc:** thông báo chưa xử lý trong 7 ngày gần nhất.
- **Lưu trữ:** thông báo từ 7 đến 30 ngày trước.

Bấm một thông báo để đánh dấu đã đọc và mở đúng dự án/task liên quan. Thông báo cũ hơn 30 ngày được tự động xóa.

Bạn có thể nhận thông báo khi:

- Được giao task.
- Task bạn tạo hoặc theo dõi hoàn thành.
- Có bình luận trong task bạn làm, giao hoặc theo dõi.
- Được thêm làm người theo dõi.
- Task được theo dõi thay đổi trạng thái, người phụ trách hoặc hạn chót.
- Task đến hạn hôm nay hoặc đã quá hạn.

## 11. Google Chat

Chủ dự án hoặc Admin có thể kết nối mỗi dự án với một Google Chat Space riêng.

1. Mở dự án và chọn tab **Webhook**.
2. Dán URL webhook của Google Chat Space.
3. Bấm **Lưu webhook**.
4. Bấm **Gửi thử** để kiểm tra.

Sau khi kết nối, Google Chat có thể nhận thông tin về task mới, thay đổi trạng thái, thay đổi người phụ trách, bình luận và bản nhắc việc hằng ngày. Mỗi tin có liên kết mở đúng task.

Để đổi Space, dán URL mới và lưu lại. Bấm **Ngắt kết nối** nếu không muốn gửi thông báo nữa. Không chia sẻ URL webhook vì URL này có quyền gửi tin vào Space.

## 12. Doanh số

Trang **Doanh số** chỉ dành cho `ACCOUNT` và `ADMIN`:

- `ADMIN` xem dữ liệu toàn công ty.
- `ACCOUNT` chỉ xem các dự án mình tham gia.

Các chỉ số chính:

- **Doanh số ghi nhận:** tổng doanh thu của dự án `On Process` và `Done`.
- **Giá trị Bidding:** tổng giá trị cơ hội đang `Bidding`.
- **Tỷ lệ thắng:** số dự án `On Process` hoặc `Done` chia cho tổng số dự án thắng và thua (`On Process`, `Done`, `Cancel`, `Fail`).
- **Dự án hoạt động:** số dự án `Bidding` và `On Process`.

Trang còn có:

- Lịch dự án đang chạy, sắp tới và 30 ngày vừa qua.
- Biểu đồ doanh thu 12 tháng gần nhất.
- Pipeline theo trạng thái.
- Cơ cấu và doanh số theo loại hình.
- Doanh số theo Team, Account và Client.
- Danh sách dự án nhóm theo trạng thái.

Doanh thu được ghi nhận vào tháng dự án lần đầu chuyển sang `On Process`. Vì vậy nên cập nhật trạng thái dự án chính xác.

## 13. Hiệu suất

Trang **Hiệu suất** cho phép chọn:

- **Tháng này**
- **Tháng trước**
- **Quý này**

Mọi người đều thấy hiệu suất của chính mình. Người quản lý thấy nhân viên trực tiếp; Admin thấy toàn bộ nhân viên và các thống kê chung.

Các nhóm kết quả gồm:

- Hoàn thành đúng hạn.
- Hoàn thành trễ hạn.
- Đang mở nhưng quá hạn.
- Đang làm.
- Cần làm.

Tỷ lệ đúng hạn được tính bằng:

```text
Số task hoàn thành đúng hạn / Tổng task hoàn thành trong kỳ
```

Task hoàn thành mà không có hạn chót được tính là đúng hạn. Bấm một nhân viên để xem hiệu suất, dự án đang tham gia, việc được giao và việc giao cho người khác.

Riêng Admin còn thấy:

- Tổng số việc đang mở, đang làm và quá hạn.
- Nhân sự có nhiều task đang mở, quá hạn hoặc hoàn thành đúng hạn nhất.
- Danh sách task chưa gán người làm.

## 14. Cài đặt dành cho Admin

Chỉ `ADMIN` truy cập được mục **Cài đặt**.

### Tạo tài khoản

1. Mở **Cài đặt → Tạo tài khoản**.
2. Thêm ảnh đại diện nếu cần. Ảnh gốc phải dưới 5 MB.
3. Nhập họ tên, email và mật khẩu ít nhất 10 ký tự.
4. Chọn vai trò `User`, `Account` hoặc `Admin`.
5. Bấm **Tạo tài khoản**.

### Quản lý tài khoản

Trong tab **Quản lý tài khoản**, Admin có thể:

- Lọc theo vai trò hoặc trạng thái vô hiệu hóa.
- Sửa họ tên, ảnh đại diện và vai trò.
- Gán hoặc bỏ người quản lý trực tiếp rồi bấm **Lưu**.
- Đặt mật khẩu mới.
- Vô hiệu hóa hoặc kích hoạt lại tài khoản.
- Xóa vĩnh viễn một tài khoản không còn dữ liệu liên quan.

Nên ưu tiên **Vô hiệu hóa** thay vì xóa để giữ lịch sử công việc. Khi vô hiệu hóa, người dùng bị đăng xuất và không thể đăng nhập. Muốn xóa vĩnh viễn, tài khoản phải được vô hiệu hóa trước và không còn sở hữu/tham gia dự án, task hoặc liên kết Account.

### Phòng ban / Nhóm

Tab **Phòng ban / Nhóm** dùng để tạo nhóm nhân sự theo phòng ban (Creative, Operations…) hoặc nhóm phối hợp:

1. Đặt tên nhóm.
2. Tìm và chọn thành viên.
3. Lưu nhóm.

Nhóm có thể sửa hoặc xóa và được dùng để thêm nhiều người vào dự án cùng lúc. Nếu xóa nhóm đang phụ trách dự án, dự án sẽ trở thành chưa gán nhóm phụ trách; thành viên và dữ liệu dự án vẫn được giữ. Thành viên được thêm tại thời điểm thao tác; sửa nhóm sau đó không tự thay đổi thành viên các dự án trước đó.

### Client

Tab **Client** dùng để thêm, đổi tên hoặc xóa khách hàng. Xóa Client không xóa dự án; các dự án liên quan sẽ chuyển thành chưa gán Client.

### Team & Account

Mở **Cài đặt → Team & Account** để quản lý Team kinh doanh và Account trong cùng một màn hình.

Ở phần **Team kinh doanh** phía trên, tạo Team trước khi thêm Account. Team mới sẽ xuất hiện ngay trong danh sách chọn Team ở phần Account bên dưới. Nếu Team đang được Account sử dụng, hãy chuyển Account sang Team khác trước khi xóa.

Ở phần **Account** phía dưới:

1. Chọn một người dùng có vai trò `Account` hoặc `Admin`.
2. Chọn Team bắt buộc.
3. Bấm **Lưu**.

Sau khi tạo, có thể đổi Team của Account; các dự án Khách hàng gắn với Account đó sẽ tự chuyển về Team mới. Nếu Account đang gắn với dự án, cần đổi Account của các dự án đó trước khi xóa.

## 15. Biên bản họp

Sau khi cuộc họp bắt đầu, thẻ cuộc họp trong **Lịch họp** có nút **Tạo biên bản** (chỉ người tổ chức và Admin thấy).

### Tạo biên bản

Khi cuộc họp bắt đầu, người tổ chức nhận thông báo (trong app và trên điện thoại nếu đã bật thông báo) *"Cuộc họp … đã bắt đầu. Bấm để ghi âm và tạo biên bản."*. Bấm vào là mở trang biên bản và **bắt đầu ghi âm ngay** (họp online thì bấm thêm **Bắt đầu ghi âm** để chọn tab cuộc họp). Cũng có thể tự mở **Lịch họp → Tạo biên bản** ở cuộc họp đã bắt đầu. Có hai cách:

**Ghi âm ngay trong app** (tab *Ghi âm trong app*)

1. Bấm **Bắt đầu ghi âm** (hoặc bấm vào thông báo cuộc họp đã bắt đầu) và cho phép trình duyệt dùng micro.
2. Đặt máy gần người nói. Thanh đỏ nhấp nháy theo tiếng nói nghĩa là micro đang thu. Có thể **Tạm dừng** / **Ghi tiếp**.
3. Họp xong bấm **Dừng ghi**, nghe lại nếu cần, rồi bấm **Tạo biên bản từ bản ghi này**.
4. Lỡ quên bấm Dừng ghi: app tự dừng và **tự tạo biên bản** khi đã **quá giờ kết thúc 10 phút** hoặc **không nghe thấy tiếng nói trong 10 phút**. Trước đó app hiện đếm ngược kèm nút **Vẫn đang họp** (họp kéo dài thì bấm để lùi thêm 30 phút) và **Dừng và tạo biên bản**. Cách tự dừng này cần tab taskflow còn mở trên máy đang ghi.

Bản ghi được lưu dần trên máy (5 giây một lần): lỡ đóng tab hay tải lại trang, mở lại trang biên bản sẽ thấy *"Có bản ghi chưa gửi trên máy này"* (có thể mất vài giây cuối). Trên điện thoại, giữ màn hình mở và ở lại trang trong lúc ghi — khoá máy hoặc chuyển ứng dụng có thể làm trình duyệt dừng ghi.

**Họp online (Google Meet, Zoom trên web…)** — chỉ dùng được với Chrome hoặc Edge trên máy tính:

1. Mở cuộc họp ở một tab (nếu lịch họp có link, bấm *mở link họp* ngay trong trang biên bản).
2. Ở trang biên bản chọn **Họp online** (lịch có link họp thì app chọn sẵn), bấm **Bắt đầu ghi âm**.
3. Chrome hỏi chia sẻ gì: chọn **tab cuộc họp**, bật **"Chia sẻ âm thanh của tab"**, bấm **Chia sẻ**. Sau đó cho phép micro để ghi cả giọng của bạn.
4. Giữ cả tab cuộc họp và tab taskflow mở. Họp xong chỉ cần **đóng tab cuộc họp** (hoặc bấm *Dừng chia sẻ* trên thanh của Chrome): app tự dừng ghi và **tự tạo biên bản**, không cần bấm thêm. Bản ghi dưới 30 giây (thường do bấm nhầm) thì app chỉ dừng ghi, không tự tạo biên bản. Muốn đọc lại trước khi tạo, bấm **Dừng ghi** trên taskflow thay vì đóng tab họp.

App trộn tiếng mọi người trong tab họp với giọng của bạn thành một bản ghi. Nếu không cho phép micro, app vẫn ghi tiếng từ tab họp (nhãn *"chỉ tab họp"*).

**Tải file có sẵn** (tab *Tải file lên*)

1. Chọn file ghi âm (mp3, m4a, wav, webm, ogg, flac hoặc mp4, tối đa 100 MB).
2. Bấm **Tạo biên bản**.

Sau đó AI chép lời rồi viết biên bản, thường mất 1–3 phút. Có thể rời trang; khi xong app sẽ thông báo.

Giới hạn: mỗi file tối đa 3 giờ; mỗi cuộc họp chép lời tối đa 3 lần và viết lại tối đa 6 lần mỗi ngày; cả công ty có hạn mức phút chép lời mỗi ngày. Khi chạm giới hạn, app báo lý do và mở lại vào ngày hôm sau.

File ghi âm bị xoá ngay sau khi chép lời. App giữ lại bản chép lời (chỉ người tổ chức và Admin xem được) và biên bản.

### Đọc lại và gửi

- Biên bản gồm: Tóm tắt, Nội dung chính, Quyết định, Việc cần làm (người phụ trách, hạn) và Vấn đề còn mở.
- AI có thể nghe sai tên riêng hoặc con số. Bấm **Sửa** để chỉnh: dòng bắt đầu bằng `## ` là tiêu đề, dòng bắt đầu bằng `- ` là gạch đầu dòng.
- **Viết lại** nhờ AI viết lại từ bản chép lời (những chỗ đã sửa tay sẽ mất).
- Bấm **Gửi cho người tham dự**: mọi người nhận thông báo trong app và email (nếu app đã cấu hình email). Trước khi gửi, người tham dự chưa xem được biên bản.
- **Xoá biên bản** xoá cả biên bản lẫn bản chép lời.

### Biên bản của cuộc họp dự án

Cuộc họp tạo bằng nút **Tạo cuộc họp** trong trang dự án được gắn với dự án đó. Khi người tổ chức bấm **Gửi cho người tham dự**, biên bản được lưu thành file Word *"Biên bản họp - <tên cuộc họp> - <ngày>.docx"* trong tab **Tài liệu** của dự án (mọi thành viên dự án xem được). Gửi lại thì file được thay bằng bản mới, không tạo thêm file trùng.

## 16. Quy trình sử dụng đề xuất

### Nhận thông báo trên điện thoại

- **iPhone/iPad:** dùng iOS 16.4 trở lên. Mở địa chỉ HTTPS của app trong Safari → Chia sẻ → Thêm vào Màn hình chính. Mở app bằng biểu tượng mới và đăng nhập.
- **Android/máy tính:** mở app bằng trình duyệt hỗ trợ Web Push, chẳng hạn Chrome.
- Vào **Thông báo → Thông báo trên thiết bị → Bật thông báo**, rồi chọn cho phép. Bấm **Gửi thông báo thử** để kiểm tra. Nếu chưa thấy, kiểm tra quyền thông báo và chế độ Không làm phiền của điện thoại.
- Mỗi thiết bị bật/tắt riêng. Đăng xuất sẽ ngừng nhận trên thiết bị đó; đăng nhập lại cần bật lại thông báo. Chạm thông báo để mở đúng công việc hoặc lời cảm ơn.


### Đầu ngày

1. Mở **Công việc → Tổng quan**.
2. Xử lý task quá hạn và sắp đến hạn trước.
3. Kiểm tra **Thông báo → Chưa đọc**.
4. Cập nhật task đang làm sang cột **Đang làm**.

### Trong ngày

1. Ghi mô tả hoặc trao đổi bằng bình luận trong task.
2. Thêm người theo dõi nếu cần phối hợp.
3. Lưu file bàn giao trong tab **Tài liệu**.
4. Ghi kết quả/bàn giao trước khi chuyển task sang **Hoàn thành**.

### Cuối ngày hoặc cuối dự án

1. Cập nhật trạng thái task và hạn chót còn lại.
2. Kiểm tra task chưa gán người làm.
3. Khi dự án được chốt, chuyển từ `Bidding` sang `On Process`.
4. Khi hoàn tất toàn bộ, chuyển dự án sang `Done`.

## 16. Xử lý sự cố thường gặp

| Hiện tượng | Cách xử lý |
| --- | --- |
| Không đăng nhập được | Kiểm tra email/mật khẩu; nếu bị khóa tạm thời hãy chờ; nếu tài khoản bị vô hiệu hóa hãy liên hệ Admin. |
| Không thấy nút tạo dự án | Tài khoản `USER` không có quyền; cần vai trò `ACCOUNT` hoặc `ADMIN`. |
| Không giao được task cho một người | Thêm người đó vào dự án trước. |
| Không thấy dự án trong danh sách | Kiểm tra mục **Lưu trữ** hoặc nhờ thành viên dự án mời bạn. |
| Không sửa được dự án/trạng thái | Chỉ chủ dự án hoặc Admin có quyền. |
| Không xóa được dự án | Chỉ chủ dự án có quyền xóa. |
| Không tải được file | Kiểm tra định dạng hỗ trợ và dung lượng tối đa 4 MB. |
| PO không được nhận diện | Chỉ dùng PDF hợp lệ dưới 4 MB; nhập các trường thủ công nếu tài liệu không đúng mẫu hỗ trợ. |
| Không thấy trang Doanh số | Trang này chỉ dành cho `ACCOUNT` và `ADMIN`. |
| Không xóa được tài khoản | Vô hiệu hóa trước, sau đó chuyển hoặc xóa hết dữ liệu và liên kết Account liên quan. |
| Google Chat không nhận tin | Kiểm tra đúng URL webhook, bấm **Gửi thử**, và xác nhận webhook chưa bị xóa trong Google Chat Space. |

Nếu vẫn không xử lý được, gửi cho Admin: tên tài khoản, tên dự án/task, thao tác đã thực hiện và nội dung lỗi hiển thị trên màn hình. Không gửi mật khẩu hoặc URL webhook qua kênh công khai.
