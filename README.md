# TaskFlow

TaskFlow là ứng dụng quản lý project và task nội bộ cho nhóm. App hỗ trợ tạo project, chia việc theo bảng Kanban, theo dõi hạn chót, bình luận trong task, xem doanh số theo Client/Account và quản trị tài khoản nhân viên.

Ứng dụng không có đăng ký công khai. Tài khoản được tạo bởi admin.

## Mục lục

- [Công nghệ sử dụng](#công-nghệ-sử-dụng)
- [Design system](#design-system)
- [Vai trò người dùng](#vai-trò-người-dùng)
- [Hướng dẫn sử dụng app](#hướng-dẫn-sử-dụng-app)
- [Chạy app trên máy cá nhân](#chạy-app-trên-máy-cá-nhân)
- [Biến môi trường](#biến-môi-trường)
- [Production và triển khai](#production-và-triển-khai)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Luồng dữ liệu chính](#luồng-dữ-liệu-chính)
- [Một số lưu ý vận hành](#một-số-lưu-ý-vận-hành)

## Công nghệ sử dụng

- Next.js 16 App Router, Server Components và Server Actions
- React 19, TypeScript, Tailwind CSS 4
- Prisma 6 với PostgreSQL
- Đăng nhập bằng email/mật khẩu, mật khẩu hash bằng `bcryptjs`
- Session cookie ký bằng JWT qua `jose`
- Kéo thả Kanban bằng `@hello-pangea/dnd`

## Design system

TaskFlow dùng **myCreative UI Foundation v1** làm nền giao diện chung cho các màn mới của TaskFlow, COSTFLOW và WORKFLOW. Xem [hợp đồng sử dụng và API component](docs/DESIGN_SYSTEM.md); mở `/design-system` khi app đang chạy để thử các trạng thái form, nút, bảng và dialog bằng dữ liệu giả lập.

Tokens nằm trong `app/design-system.css`, component chung trong `components/ui/`. Màn đăng nhập đã áp dụng; các màn khác chuyển dần khi triển khai tính năng liên quan. TypeScript, lint phần thay đổi, build cục bộ và browser UI đã được kiểm tra; chưa xác minh DB/nghiệp vụ hoặc triển khai production.

## Vai trò người dùng

TaskFlow có 3 vai trò:

| Vai trò | Quyền chính |
| --- | --- |
| `ADMIN` | Quản trị toàn bộ hệ thống: tạo/xóa user, tạo nhóm cố định, quản lý Client/Team/Account, xem hiệu suất và doanh số toàn công ty, sửa mọi project. |
| `ACCOUNT` | Tạo project, quản lý project mình tham gia, xem trang doanh số trong phạm vi project mình tham gia. |
| `USER` | Tạo dự án Nội bộ hoặc Khách hàng, quản lý dự án mình sở hữu, nhận việc, cập nhật task và bình luận. Không xem/sửa doanh thu và không nhập PO. |

Lưu ý: chỉ chủ project mới xóa được project. Chủ project hoặc admin có thể sửa thông tin project.

## Hướng dẫn sử dụng app

### 1. Đăng nhập

Mở app, vào trang `/login`, nhập email và mật khẩu do admin cấp. Sau khi đăng nhập thành công, app chuyển về dashboard chính.

### 2. Dashboard công việc

Trang chủ `/` là nơi xem nhanh công việc cá nhân:

- "Việc được giao cho tôi": các task chưa hoàn thành mà bạn là người làm.
- "Việc tôi giao cho người khác": các task bạn tạo và đã giao cho thành viên khác.
- "Nhắc nhở": hiển thị việc quá hạn, việc đến hạn trong 3 ngày và số việc còn ở trạng thái Cần làm.
- "Projects của tôi": danh sách project bạn đang tham gia, kèm tiến độ task hoàn thành và số thành viên.

Mọi vai trò (`USER`, `ACCOUNT`, `ADMIN`) đều có nút `+ Tạo project` trên dashboard.

### 3. Tạo project mới

Mọi user đang hoạt động đều tạo được project. Người tạo tự động trở thành chủ dự án.

Vào `/projects/new`, chọn **Nội bộ** hoặc **Khách hàng** ở màn hình đầu tiên để mở form tương ứng. Bấm **Chọn lại loại dự án** để quay lại màn hình lựa chọn. Sau đó điền:

- Mục đích: **Nội bộ** hoặc **Khách hàng**
- Tên project và mô tả
- Thời gian thực hiện; loại hình chỉ dành cho dự án Khách hàng
- Với dự án Khách hàng: Client và Account từ Cài đặt; doanh thu và nhập PO dành cho Admin/Account.

Dự án Nội bộ bắt đầu ở `On Process`, không dùng Client/Account/PO và không tính vào báo cáo doanh số. Dự án Khách hàng tạo thủ công bắt đầu ở `Bidding`; nhập PO Jabil bắt đầu ở `On Process`. Dữ liệu dự án cũ mặc định là Khách hàng.

Sau khi tạo, người tạo tự động trở thành chủ project và thành viên đầu tiên.

### 4. Làm việc trong project

Trang project `/projects/[id]` là bảng Kanban gồm 3 cột:

- Cần làm
- Đang làm
- Hoàn thành

Các thao tác chính:

- Tạo task nhanh ở cuối mỗi cột.
- Khi tạo task, có thể chọn nhiều tệp giao việc và tệp kết quả, xem danh sách hoặc bỏ chọn trước khi bấm **Tạo task**. Tổng dung lượng các tệp trong một lần tạo tối đa **4 MB**; hỗ trợ PDF, hình ảnh, Word, Excel, PowerPoint, TXT và CSV.
- Task và tệp đính kèm được lưu cùng nhau. Nếu tệp không hợp lệ, nội dung đã nhập và danh sách tệp được giữ lại để sửa và gửi lại.
- Kéo thả task giữa các cột hoặc đổi vị trí trong cùng cột.
- Bấm vào task để mở chi tiết.
- Trong chi tiết task có thể sửa tiêu đề, mô tả, trạng thái, độ ưu tiên, người làm, hạn chót và bình luận.
- Hạn chót đặt được cả **ngày và giờ** (ví dụ 15/7 16:30); quá hạn tính theo đúng giờ.
- Trong chi tiết task có mục **Người theo dõi**: tự bấm `☆ Theo dõi`, hoặc thêm thành viên khác vào theo dõi qua dropdown. Người theo dõi nhận thông báo khi task hoàn thành hoặc có bình luận, và được báo khi bị thêm vào.
- Khi task chuyển sang Hoàn thành, app lưu thời điểm hoàn thành để tính hiệu suất đúng hạn/trễ hạn.
- Có thể xóa task trong cửa sổ chi tiết task.

### 5. Quản lý thành viên project

Ở góc trên trang project có khu vực thành viên:

- Bấm vào cụm avatar để mở danh sách thành viên.
- Nhập email để mời thêm thành viên. Người được mời phải có tài khoản sẵn trong hệ thống.
- Chọn một **phòng ban / nhóm** để thêm toàn bộ người trong nhóm vào project trong một lần.
- Chủ project có thể xóa thành viên khỏi project.
- Thành viên có thể tự rời project.
- Không thể xóa chủ project khỏi project.

### 6. Sửa hoặc xóa project

Trong trang project:

- Bấm nút sửa cạnh tên project để cập nhật tên, mô tả, tình trạng, doanh thu, Client và Account.
- Chủ project hoặc `ADMIN` được sửa thông tin project.
- Chỉ chủ project được xóa project.

### 7. Xem doanh số

Trang `/revenue` dành cho `ADMIN` và `ACCOUNT`.

Nội dung gồm:

- **Cơ cấu doanh số**: thanh stacked thể hiện tỷ trọng Doanh thu (On Process + Done) / Bidding / Fail kèm số liệu từng nhóm.
- **Theo Client / Theo Account**: bar chart ngang so sánh doanh thu thực (thanh xanh) và giá trị đang bidding (thanh vàng).
- **Các dự án**: danh sách gọn nhóm theo tình trạng, mỗi nhóm có tổng phụ; chủ dự án hiển thị dạng avatar.

`ADMIN` thấy toàn công ty. `ACCOUNT` chỉ thấy các project mình tham gia.

### 8. Hiệu suất

Trang `/team` dành cho mọi người dùng, dữ liệu hiển thị phụ thuộc vai trò:

- Mọi người đều thấy hiệu suất của chính mình.
- `ADMIN` thấy thêm: 3 số tổng (việc đang mở / đang làm / quá hạn), bảng toàn bộ nhân viên và danh sách việc chưa gán cho ai.
- Người quản lý thấy nhân viên trực tiếp được admin gán cho mình.

Nhân viên hiển thị dạng **bảng xếp hạng** theo % đúng hạn — mỗi người một dòng với thanh hiệu suất thu nhỏ, % đúng hạn, số việc đang mở và quá hạn. Bấm vào dòng để xem chi tiết (email, thanh hiệu suất đầy đủ, việc được giao, việc giao ra).

Hiệu suất phân loại: Đúng hạn / Trễ hạn / Quá hạn / Đang làm / Cần làm.

### 9. Cài đặt

Trang `/admin` chỉ dành cho `ADMIN`.

Các tab được sắp theo luồng sử dụng:

- **Tạo tài khoản**: tạo user với vai trò `ADMIN`, `ACCOUNT` hoặc `USER`.
- **Quản lý tài khoản**: đổi quản lý, đổi mật khẩu hoặc xoá tài khoản.
- **Tạo nhóm**: tạo, sửa và xoá nhóm nhân sự cố định dùng lại trong nhiều project.
- **Client**: quản lý danh sách khách hàng.
- **Team & Account**: quản lý Team kinh doanh và Account trong cùng một tab. Tạo Team ở phần trên, sau đó chọn user vai trò `ACCOUNT` hoặc `ADMIN` và gán vào Team ở phần dưới.

Các thay đổi chỉ được xác nhận sau khi bấm **Lưu thay đổi**. Đường dẫn cũ `/admin/catalog` tự chuyển về tab Client trong Cài đặt; `/admin?tab=team` vẫn mở tab **Team & Account**.

Lưu ý: trang "Toàn cảnh công việc" (`/admin/overview`) đã được gộp vào **Hiệu suất** (`/team`); đường dẫn cũ tự chuyển hướng sang trang mới.

### 10. Thông báo

Chuông `🔔 Thông báo` ở sidebar hiển thị số thông báo chưa đọc. Trang `/notifications` liệt kê chi tiết và tự đánh dấu đã đọc khi mở.

Bạn nhận thông báo khi:

- Có người giao task cho bạn.
- Task bạn đã giao hoặc đang theo dõi được hoàn thành.
- Có bình luận mới trong task bạn làm, bạn giao hoặc bạn theo dõi.

Bấm vào thông báo để nhảy đến project liên quan. Người thao tác không tự nhận thông báo về hành động của chính mình.

**Thông báo đẩy trên điện thoại/máy tính:** vào **Thông báo → Thông báo trên thiết bị → Bật thông báo** và cho phép trình duyệt. Mỗi thiết bị đăng ký riêng; có thể gửi thông báo thử hoặc tắt trên thiết bị đó. iPhone/iPad cần iOS 16.4+ và mở app đã thêm vào Màn hình chính. Server cần `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (xem `.env.example`). Khóa phải được giữ cố định qua các lần triển khai. Đăng xuất sẽ hủy đăng ký trên thiết bị hiện tại. Thông báo thường và nhắc hạn hằng ngày đều gửi thêm Web Push; lỗi push không làm mất thông báo trong app. Service worker chỉ xử lý push, không lưu trang hay tài liệu đăng nhập để dùng offline.

### 11. Góc cảm ơn

Trang `/recognition` là không gian ghi nhận độc lập với project, dành cho những điều tử tế trong công việc và cuộc sống:

- Chọn một đồng đội, viết lời cảm ơn và gửi một ngôi sao.
- Chọn chủ đề: Một điều tử tế, Hỗ trợ công việc, Truyền cảm hứng hoặc Quan tâm đồng đội.
- Chọn chia sẻ trong công ty hoặc chỉ để người gửi và người nhận xem.
- Xem các tab Mọi người, Dành cho tôi và Tôi đã gửi theo từng tháng.
- Bảng “Dải ngân hà nhà mình” ghi nhận số người khác nhau đã gửi hoặc nhận sao; bảng này không dùng để đánh giá hiệu suất.

Người nhận sẽ nhận được thông báo và có thể mở thẳng lời cảm ơn tương ứng.

**Báo lên Google Chat (tuỳ chọn):** trong từng dự án, mở tab **Webhook** và dán URL webhook của Space tương ứng. App gửi tin khi có job mới, đổi người được giao hoặc đổi trạng thái; mỗi tin có người được giao và link mở đúng job. Hướng dẫn lấy URL xem trong [DEPLOY.md](DEPLOY.md).

## Chạy app trên máy cá nhân

Cần có Node.js, npm và PostgreSQL.

Nếu chưa có PostgreSQL trên macOS:

```bash
brew install postgresql@16
brew services start postgresql@16
createdb taskflow
```

Cài đặt và chạy app:

```bash
cp .env.example .env
npm install
npx prisma migrate dev
npm run seed
npm run dev
```

Sau đó mở:

```text
http://localhost:3000
```

`npm run seed` sẽ xoá dữ liệu cũ và tạo bộ mẫu 10 tài khoản, 10 dự án. Đăng nhập bằng `admin@mycreative.vn`, mật khẩu `gasangtao1810`.

## Biến môi trường

Tạo file `.env` từ `.env.example` và điền:

| Biến | Ý nghĩa |
| --- | --- |
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL. Dev cục bộ thường là `postgresql://<user>@localhost:5432/taskflow`. |
| `SESSION_SECRET` | Chuỗi bí mật để ký session cookie. Cần đặt chuỗi dài, ngẫu nhiên. |
| `ADMIN_NAME` | Tên admin khi chạy seed với `SEED_MODE=admin`. |
| `ADMIN_EMAIL` | Email admin khi chạy seed với `SEED_MODE=admin`. |
| `ADMIN_PASSWORD` | Mật khẩu admin khi chạy seed với `SEED_MODE=admin`. |

Tạo `SESSION_SECRET` bằng:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Production và triển khai

Production hiện tại chạy tại [taskflow.work-vpth.workers.dev](https://taskflow.work-vpth.workers.dev) với kiến trúc:

- **Runtime:** Cloudflare Workers, đóng gói Next.js bằng OpenNext.
- **Database:** Neon PostgreSQL tại region Singapore.
- **Secrets:** `DATABASE_URL` và `SESSION_SECRET` được lưu bằng Cloudflare Worker secrets; không ghi vào source, log hoặc README.
- **Cấu hình Worker:** `wrangler.jsonc`; bundle được tạo trong `.open-next/` và không commit vào Git.

Quy trình deploy production phải dùng một checkout sạch tại đúng commit cần phát hành để tránh đưa WIP chưa commit vào bundle:

```bash
npm ci
npx prisma migrate deploy
npm run build:cloudflare
npx wrangler deploy
npx wrangler deployments list
```

`DATABASE_URL` dùng cho `prisma migrate deploy` phải là kết nối trực tiếp tới đúng Neon production database. Chạy migration thành công trước khi publish Worker; không seed hoặc reset production. Sau deploy, tối thiểu kiểm tra `/login`, `manifest.webmanifest`, version ID trên Cloudflare và các luồng authenticated liên quan tới thay đổi.

Deploy kỹ thuật không đồng nghĩa với business release acceptance. COSTFLOW/WORKFLOW chỉ được đánh dấu sẵn sàng phát hành khi các checkpoint human/company/native/production và sign-off tương ứng đã hoàn tất. Hướng dẫn Vercel cũ và các lưu ý nền tảng khác vẫn nằm trong [DEPLOY.md](DEPLOY.md) cho tới khi tài liệu đó được cập nhật toàn bộ sang Cloudflare.

## Cấu trúc thư mục

```text
.
├── app/
│   ├── actions/
│   │   ├── admin.ts          # Server Actions cho quản trị user, đổi mật khẩu, gán quản lý
│   │   ├── auth.ts           # Đăng nhập / đăng xuất
│   │   ├── catalog.ts        # Tạo / xóa Client và Account
│   │   ├── projects.ts       # Tạo, sửa, xóa project; thêm / xóa thành viên
│   │   └── tasks.ts          # Tạo, sửa, xóa, kéo thả task; thêm bình luận
│   ├── admin/
│   │   ├── catalog/          # Trang quản lý Client & Account
│   │   ├── overview/         # Redirect sang /team (trang cũ đã gộp)
│   │   └── page.tsx          # Trang quản trị người dùng
│   ├── login/                # Trang đăng nhập
│   ├── notifications/        # Trang thông báo
│   ├── projects/
│   │   ├── [id]/             # Trang chi tiết project và Kanban board
│   │   └── new/              # Trang tạo project mới
│   ├── revenue/              # Trang doanh số
│   ├── team/                 # Trang đội & hiệu suất
│   ├── globals.css           # CSS toàn cục
│   ├── layout.tsx            # Layout gốc
│   └── page.tsx              # Dashboard chính
├── components/
│   ├── Board.tsx             # Kanban board và kéo thả task
│   ├── CatalogManager.tsx    # UI quản lý danh mục Client/Account
│   ├── CreateUserForm.tsx    # Form tạo user
│   ├── DeleteProjectButton.tsx
│   ├── MembersBar.tsx        # Danh sách/mời/xóa thành viên project
│   ├── NewProjectForm.tsx
│   ├── NewTaskInline.tsx
│   ├── PerformanceBar.tsx
│   ├── ProjectEditButton.tsx
│   ├── RevenueBreakdown.tsx
│   ├── Sidebar.tsx
│   ├── TaskListItem.tsx
│   ├── TaskModal.tsx         # Cửa sổ chi tiết task
│   └── UserRow.tsx           # Một dòng user trong trang admin
├── lib/
│   ├── auth.ts               # Kiểm tra đăng nhập, phân quyền
│   ├── avatar.ts             # Màu avatar theo user
│   ├── dates.ts              # Tính ngày đến hạn/quá hạn
│   ├── notify.ts             # Tạo thông báo cho nhiều người nhận
│   ├── performance.ts        # Tính hiệu suất task
│   ├── prisma.ts             # Prisma client dùng chung
│   ├── session.ts            # Tạo/đọc/xóa session cookie
│   └── types.ts              # Kiểu dữ liệu và nhãn trạng thái/ưu tiên
├── prisma/
│   ├── migrations/           # Lịch sử thay đổi database
│   ├── schema.prisma         # Schema PostgreSQL
│   └── seed.ts               # Tạo dữ liệu mẫu hoặc bootstrap Admin production
├── public/                   # Asset tĩnh
├── DEPLOY.md                 # Hướng dẫn deploy Vercel + Neon
├── package.json              # Script và dependencies
└── next.config.ts            # Cấu hình Next.js
```

## Luồng dữ liệu chính

- Người dùng đăng nhập qua `app/actions/auth.ts`.
- `lib/session.ts` tạo cookie `session` có thời hạn 7 ngày.
- Các trang server gọi `requireUser`, `requireAdmin` hoặc `requireRevenueViewer` trong `lib/auth.ts` để chặn truy cập không đúng quyền.
- Dữ liệu được đọc/ghi bằng Prisma qua `lib/prisma.ts`.
- Các thao tác tạo/sửa/xóa nằm trong `app/actions/*`.
- Sau khi cập nhật dữ liệu, Server Actions gọi `revalidatePath` để làm mới màn hình liên quan.

## Script thường dùng

| Lệnh | Công dụng |
| --- | --- |
| `npm run dev` | Chạy app ở môi trường dev. |
| `npm run build` | Generate Prisma client, chạy migration deploy và build Next.js. |
| `npm run start` | Chạy bản production sau khi build. |
| `npm run lint` | Kiểm tra lint. |
| `npm run seed` | Xoá dữ liệu cũ và tạo bộ mẫu 10 tài khoản, 10 dự án. |
| `SEED_MODE=admin npm run seed` | Tạo/cập nhật một Admin mà không xoá dữ liệu production. |
| `npx prisma migrate dev` | Tạo/chạy migration khi phát triển local. |
| `npx prisma migrate deploy` | Chạy migration trong môi trường deploy. |

## Một số lưu ý vận hành

- Không commit file `.env`.
- Không chia sẻ `DATABASE_URL` hoặc `SESSION_SECRET`.
- Khi thêm nhân viên mới, admin tạo tài khoản trước rồi có thể mời từng người hoặc thêm bằng nhóm cố định.
- Khi muốn theo dõi doanh số sạch, admin tạo Client, tạo Team, rồi liên kết các user vai trò Account vào Team.
- Khi nhân viên nghỉ việc, admin có thể xóa tài khoản. Các quan hệ dữ liệu sẽ xử lý theo schema Prisma hiện tại.
- Nếu thay đổi `prisma/schema.prisma`, cần tạo migration và deploy migration cùng code.


### Phòng ban / Nhóm và mục đích dự án

Admin quản lý nhóm nhân sự trong **Cài đặt → Phòng ban / Nhóm** (ví dụ Creative, Operations). Trong một dự án, dùng **Thêm phòng ban / nhóm** để thêm các tài khoản đang hoạt động chưa có trong dự án. Danh sách được sao chép tại thời điểm thêm; đổi nhóm sau đó không tự thay đổi thành viên dự án. **Team kinh doanh** vẫn phục vụ thống kê theo Account.

Thanh bên chia dự án theo nhóm phụ trách: **Team kinh doanh → Khách hàng / Nội bộ**, còn **Phòng ban / Nhóm → Nội bộ**. Các mục con có số lượng và có thể thu gọn. Dự án Nội bộ chưa chọn nhóm phụ trách nằm trong **Chưa gán Team**; dự án Khách hàng cũ thiếu Account nằm trong **Cần gán Account**. Trong **Lưu trữ**, các nhóm trạng thái cũng có hai mục con tương ứng. Cấu trúc này áp dụng trên cả máy tính và điện thoại.

Dự án Khách hàng bắt buộc chọn **Account phụ trách** đang hoạt động và có hồ sơ Account hợp lệ. Team được lấy trực tiếp từ `Account.team`, áp dụng cho cả thanh bên và báo cáo doanh số; đổi Account hoặc Team của Account sẽ cập nhật nhóm hiển thị. Form không cho chọn nhóm phụ trách độc lập cho dự án Khách hàng. Migration xóa các liên kết nhóm phụ trách riêng của dự án Khách hàng; dự án cũ thiếu Account được giữ và đánh dấu để bổ sung.

Trường **Team/phòng ban phụ trách** chỉ dành cho Nội bộ, cho phép chọn một Team kinh doanh hoặc Phòng ban / Nhóm. `Project.responsibleTeamId` và `responsibleGroupId` là hai liên kết tùy chọn; chỉ một được gán tại mỗi thời điểm và cả hai phải trống với Khách hàng. Gán nhóm Nội bộ không cấp quyền truy cập hay tự thêm thành viên. Khi đổi Account của dự án Khách hàng, Account mới được thêm vào thành viên trong cùng transaction; thành viên cũ được giữ.

Chủ dự án hoặc Admin có thể sửa mục đích. Chuyển sang Nội bộ xoá Client, Account và doanh thu; USER không được chuyển dự án đang có doanh thu. Dự án có PO giữ mục đích Khách hàng. Quyền tạo/sở hữu dự án không cấp thêm quyền tài chính.
