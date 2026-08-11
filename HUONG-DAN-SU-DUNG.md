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
| Tạo dự án | Không | Có | Có |
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
- **Dự án:** danh sách dự án đang hoạt động, được nhóm theo Team.
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
- `ACCOUNT` và `ADMIN` có thể bấm dấu **+** cạnh tiêu đề Dự án để tạo dự án mới.

## 5. Tạo dự án

Chỉ `ACCOUNT` và `ADMIN` có thể tạo dự án.

### Tạo thủ công

1. Bấm dấu **+** cạnh mục Dự án hoặc mở **Tạo dự án mới**.
2. Nhập **Tên dự án** và mô tả nếu cần.
3. Chọn **Loại hình**: Teambuilding, MICE, Activation, Event, Pur hoặc Other.
4. Chọn **Client** và **Account**.
5. Điền ngày bắt đầu, ngày kết thúc nếu dự án chạy nhiều ngày.
6. Nhập doanh thu dự kiến bằng VND.
7. Bấm **Tạo dự án**.

Dự án tạo thủ công có trạng thái ban đầu là `Bidding`. Người tạo trở thành chủ dự án. Nếu chọn Account, người dùng gắn với Account đó cũng được thêm vào dự án.

### Tạo dự án từ PO PDF

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

Phần đầu trang dự án hiển thị trạng thái, loại hình, lịch thực hiện, Client, Account, số PO, doanh thu và thành viên. Doanh thu chỉ hiển thị cho `ACCOUNT` và `ADMIN`.

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
- Loại hình.
- Ngày thực hiện.
- Doanh thu.
- Client và Account.

Bấm **Lưu thay đổi** để xác nhận.

### Xóa dự án

Chỉ chủ dự án có thể xóa dự án. Mở menu **Thao tác khác**, chọn xóa và xác nhận. Thao tác này xóa cả task, bình luận, tài liệu và dữ liệu liên quan, nên chỉ thực hiện khi chắc chắn.

## 7. Quản lý thành viên dự án

1. Bấm cụm avatar hoặc số thành viên ở đầu trang dự án.
2. Tìm người dùng bằng tên hoặc email.
3. Chọn đúng tài khoản rồi bấm **Mời**.

Để thêm nhiều người cùng lúc:

1. Mở danh sách thành viên.
2. Ở mục **Thêm nhóm cố định**, chọn một nhóm.
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

### Tạo nhóm

Tab **Tạo nhóm** dùng để tạo nhóm nhân sự cố định:

1. Đặt tên nhóm.
2. Tìm và chọn thành viên.
3. Lưu nhóm.

Nhóm có thể sửa hoặc xóa và được dùng để thêm nhiều người vào dự án cùng lúc.

### Client

Tab **Client** dùng để thêm, đổi tên hoặc xóa khách hàng. Xóa Client không xóa dự án; các dự án liên quan sẽ chuyển thành chưa gán Client.

### Team

Tạo Team kinh doanh trước khi tạo Account. Nếu Team đang được Account sử dụng, hãy chuyển Account sang Team khác trước khi xóa.

### Account

1. Chọn một người dùng có vai trò `Account` hoặc `Admin`.
2. Chọn Team bắt buộc.
3. Bấm **Lưu**.

Sau khi tạo, có thể đổi Team hoặc xóa liên kết Account. Xóa Account không xóa tài khoản người dùng, nhưng các dự án đang gắn Account đó có thể trở thành chưa gán.

## 15. Quy trình sử dụng đề xuất

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
