# TaskFlow

TaskFlow là ứng dụng quản lý project và task nội bộ cho nhóm. App hỗ trợ tạo project, chia việc theo bảng Kanban, theo dõi hạn chót, bình luận trong task, xem doanh số theo Client/Account và quản trị tài khoản nhân viên.

Ứng dụng không có đăng ký công khai. Tài khoản được tạo bởi admin.

## Mục lục

- [Công nghệ sử dụng](#công-nghệ-sử-dụng)
- [Vai trò người dùng](#vai-trò-người-dùng)
- [Hướng dẫn sử dụng app](#hướng-dẫn-sử-dụng-app)
- [Chạy app trên máy cá nhân](#chạy-app-trên-máy-cá-nhân)
- [Biến môi trường](#biến-môi-trường)
- [Đưa app lên mạng](#đưa-app-lên-mạng)
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

## Vai trò người dùng

TaskFlow có 3 vai trò:

| Vai trò | Quyền chính |
| --- | --- |
| `ADMIN` | Quản trị toàn bộ hệ thống: tạo/xóa user, tạo nhóm cố định, quản lý Client/Team/Account, xem hiệu suất và doanh số toàn công ty, sửa mọi project. |
| `ACCOUNT` | Tạo project, quản lý project mình tham gia, xem trang doanh số trong phạm vi project mình tham gia. |
| `USER` | Xem project mình là thành viên, nhận việc, cập nhật task, kéo thả task, bình luận. Không tạo project và không xem doanh số. |

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

Nếu bạn là `ADMIN` hoặc `ACCOUNT`, nút `+ Tạo project` sẽ xuất hiện trên dashboard.

### 3. Tạo project mới

Chỉ `ADMIN` và `ACCOUNT` tạo được project.

Vào `/projects/new`, điền:

- Tên project
- Mô tả
- Tình trạng: `Bidding`, `On Process`, `Done`, `Fail`
- Doanh thu dự kiến/thực tế
- Client và Account từ Cài đặt

Sau khi tạo, người tạo tự động trở thành chủ project và thành viên đầu tiên.

### 4. Làm việc trong project

Trang project `/projects/[id]` là bảng Kanban gồm 3 cột:

- Cần làm
- Đang làm
- Hoàn thành

Các thao tác chính:

- Tạo task nhanh ở cuối mỗi cột.
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
- Chọn một **nhóm cố định** để thêm toàn bộ người trong nhóm vào project trong một lần.
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
- **Team**: tạo nhóm kinh doanh trước khi gán Account.
- **Account**: chọn user vai trò `ACCOUNT` và bắt buộc gán vào một Team.

Các thay đổi chỉ được xác nhận sau khi bấm **Lưu thay đổi**. Đường dẫn cũ `/admin/catalog` tự chuyển về tab Client trong Cài đặt.

Lưu ý: trang "Toàn cảnh công việc" (`/admin/overview`) đã được gộp vào **Hiệu suất** (`/team`); đường dẫn cũ tự chuyển hướng sang trang mới.

### 10. Thông báo

Chuông `🔔 Thông báo` ở sidebar hiển thị số thông báo chưa đọc. Trang `/notifications` liệt kê chi tiết và tự đánh dấu đã đọc khi mở.

Bạn nhận thông báo khi:

- Có người giao task cho bạn.
- Task bạn đã giao hoặc đang theo dõi được hoàn thành.
- Có bình luận mới trong task bạn làm, bạn giao hoặc bạn theo dõi.

Bấm vào thông báo để nhảy đến project liên quan. Người thao tác không tự nhận thông báo về hành động của chính mình.

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

## Đưa app lên mạng

Xem hướng dẫn triển khai từng bước trong [DEPLOY.md](DEPLOY.md). Tài liệu đó đang hướng dẫn theo phương án Vercel + Neon PostgreSQL.

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
- Các trang server gọi `requireUser`, `requireAdmin` hoặc `requireProjectManager` trong `lib/auth.ts` để chặn truy cập không đúng quyền.
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
