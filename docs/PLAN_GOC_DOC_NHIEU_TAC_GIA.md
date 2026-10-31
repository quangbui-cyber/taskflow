# Kế hoạch: Góc Đọc nhiều tác giả

Mục tiêu: Góc Đọc không còn gắn riêng với Dave Trott. Người đọc lọc được theo tác giả và tìm được theo tên tác giả, giao diện vẫn gọn như hiện tại (một hàng công cụ).

## Hiện trạng & Dữ liệu

- 200 bài: Dave Trott 150 bài; Paul Arden, George Lois, Rory Sutherland, Bob Hoffman, John Hegarty mỗi người 10 bài.
- Tác giả xác định qua tag `author:<slug>` (`getArticleAuthor` trong `lib/creative.ts`). Bài Dave Trott mặc định rơi về Dave Trott.
- Thẻ bài và bài nổi bật hiển thị đúng tên từng tác giả.
- Ô tìm kiếm dò tựa, trích dẫn, tag và tên tác giả.
- Metadata và các văn bản chung đã chuyển sang mô tả đa tác giả từ các bậc thầy sáng tạo.

## Giao diện đã duyệt (bản gọn)

```
Góc Đọc & Cảm Hứng                                     Đã đọc 60/200
Mỗi sáng một câu chuyện về quảng cáo và tư duy sáng tạo, từ những bậc thầy trong nghề.

[Bài mới nhất — giữ nguyên]

[Tất cả | Đã lưu | Đã đọc]  [👤 Tất cả tác giả ▾]  [🔍 Tìm tựa bài, tác giả, nội dung…]

Tuần này
[thẻ bài]  [thẻ bài]  [thẻ bài]
```

- Menu tác giả: "Tất cả tác giả" + 6 tác giả, mỗi dòng có số bài, sắp theo số bài giảm dần.
- Chọn một tác giả: nút đổi thành tên tác giả và có màu brand; danh sách chỉ còn bài của người đó.
- Không thêm hàng chip, khung giới thiệu tác giả hay khung gợi ý tìm kiếm.

## Tiến độ thực hiện

### [x] 1. Dữ liệu tác giả trên thẻ bài
**File:** `app/creative/page.tsx`, `components/creative/CreativeArchive.tsx`
- Đã thêm `authorSlug` và `authorName` vào `CreativeCardData`, tính một lần ở server bằng `getArticleAuthor(article.tags)`.
- `ArticleCard` và `FeaturedArticle` dùng hai trường này trực tiếp thay vì tự gọi lại hàm.

### [x] 2. Menu chọn tác giả
**File:** `components/creative/CreativeArchive.tsx`
- `AuthorMenu` đặt giữa nhóm tab và ô tìm kiếm:
  - Nút cao `h-11`, `rounded-[10px]`, `border-zinc-200`; khi đang lọc: `bg-brand-50 text-brand-900 border-brand-200`.
  - Danh sách tác giả và số bài tính động từ `articles` (sắp xếp giảm dần theo số bài).
  - Đóng khi bấm ra ngoài hoặc nhấn Esc; điều hướng bằng phím mũi tên (`ArrowDown`/`ArrowUp`), `Home`, `End`; `aria-haspopup="listbox"`, `aria-expanded`.
  - Hiệu ứng mở 150ms (`tf-popover-enter`), tự động tắt animation khi `prefers-reduced-motion`.
- Hiển thị cho cả người chưa đăng nhập.
- Tự động reset `visibleCount` về `PAGE_SIZE` (12 bài) mỗi khi đổi tác giả.

### [x] 3. Lọc và tìm kiếm
**File:** `components/creative/CreativeArchive.tsx`
- Trong `filtered`: thêm điều kiện lọc theo `authorFilter`.
- Đưa `authorName` vào `haystack`, tìm kiếm theo tên tác giả ("trott", "rory", "hegarty"...) ra đúng bài.
- Placeholder: `Tìm tựa bài, tác giả, nội dung…`.
- `isBrowsing` chuyển `false` khi chọn tác giả: ẩn thẻ "Bài mới nhất" và hiển thị danh sách bài với tiêu đề nhóm (ví dụ: `Bài của Rory Sutherland`).
- Thông báo trống khi lọc tác giả: `Không có bài phù hợp`.

### [x] 4. Tô sáng từ khoá
**File:** `components/creative/CreativeArchive.tsx`
- Hàm `highlight(text, query)` so khớp không dấu chuẩn xác 1-1 với ký tự gốc, bọc phần khớp bằng `<mark className="rounded-sm bg-brand-100 text-inherit">`.
- Áp dụng trên `ArticleCard` cho tựa bài và tên tác giả khi đang tìm kiếm.

### [x] 5. Ghi nhớ bộ lọc trên URL
**File:** `components/creative/CreativeArchive.tsx`, `app/creative/page.tsx`
- Đồng bộ query `?tac-gia=<slug>` trên URL bằng `router.replace(..., { scroll: false })` không cuộn trang.
- Đọc giá trị ban đầu từ `searchParams` ở server, xác thực slug hợp lệ trước khi truyền xuống `initialAuthor`.

### [x] 6. Bỏ chữ "Dave Trott" ở các chỗ chung
- `app/creative/page.tsx`: metadata description và dòng phụ `ArchiveHeader` → `Những câu chuyện quảng cáo và tư duy sáng tạo từ các bậc thầy trong nghề.` / `Mỗi sáng một câu chuyện về quảng cáo và tư duy sáng tạo, từ những bậc thầy trong nghề.`
- `app/creative/[slug]/page.tsx`: description → `Góc Đọc & Cảm Hứng · {tên tác giả}: {tựa gốc}` (chọn thêm `tags` trong query metadata).
- Đã sửa các chú thích trong `lib/creative.ts`, `lib/features.ts`, `lib/creativeSeed.ts`.

### [x] 7. Trang đọc bài: phần cuối trang
**File:** `lib/creative.ts`, `components/creative/ZenReader.tsx`, `app/creative/[slug]/page.tsx`
- Thêm trường `hasOriginalArticles: boolean` vào `AuthorMetadata` (chỉ Dave Trott là `true`, các tác giả từ sách/trích dẫn là `false`).
- Thêm hàm `getOriginalArticleUrl(article)`: chỉ trả về link khi tác giả có bài gốc thật trực tuyến.
- Thanh công cụ chân trang đọc: chỉ hiện "Xem bài gốc trên davetrott.co.uk ↗" khi có bài gốc; tác giả khác chỉ gồm 3 nút Thích / Lưu bài / Chia sẻ.
- Hộp ghi nhận cuối trang:
  - Dave Trott: `Bài viết gốc của Dave Trott tại davetrott.co.uk. Bản dịch tiếng Việt của myCreative, dùng cho mục đích học tập nội bộ.` (tên miền là link)
  - Tác giả khác: `Nội dung của {tên tác giả}. Bản dịch tiếng Việt của myCreative, dùng cho mục đích học tập nội bộ.` (không có link ra ngoài)
- Bài trước / bài tiếp theo:
  - Sắp xếp theo `publishedDate` khớp với trang danh sách (chỉ lấy bài đã phát hành `<= now`).
  - Thêm dòng nhỏ tên tác giả dưới tựa bài.
  - Nhãn "Bài trước" / "Bài tiếp theo" viết thường kiểu câu (Sentence case).
  - Tựa bài trên thẻ dùng tựa tiếng Việt kiểu câu (`toDisplayTitle`).
  - Chạy theo dòng thời gian chung của toàn bộ kho bài viết.

### [x] 8. Kiểm tra chất lượng
- `npx tsc --noEmit`: 0 lỗi type.
- `npx eslint`: 0 lỗi lint trên các file sửa đổi.
- `node --import tsx --test tests/creative.test.ts`: 11/11 tests passed.
- `npm test`: 313/313 tests passed.
- `npm run build:app`: Biên dịch Next.js và generate static/dynamic pages thành công.

## File thay đổi
| File | Thay đổi |
| --- | --- |
| `app/creative/page.tsx` | Thêm `authorSlug`/`authorName`, đọc `?tac-gia`, sửa metadata và dòng phụ |
| `components/creative/CreativeArchive.tsx` | Menu tác giả, lọc, tìm theo tác giả, tô sáng, đồng bộ URL |
| `app/creative/[slug]/page.tsx` | Mô tả trang theo tác giả, bài trước/sau xếp theo `publishedDate` và kèm tên tác giả |
| `components/creative/ZenReader.tsx` | Link bài gốc có điều kiện, hộp ghi nhận theo tác giả, thẻ bài trước/sau |
| `lib/creative.ts` | `hasOriginalArticles`, `getOriginalArticleUrl`, sửa chú thích |
| `lib/features.ts`, `lib/creativeSeed.ts` | Sửa chú thích |
| `tests/creative.test.ts` | Unit test cho `getArticleAuthor`, `KNOWN_AUTHORS`, `getOriginalArticleUrl` |
