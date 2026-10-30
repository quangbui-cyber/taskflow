# Prompt chuyển phiên: dịch lại Góc Đọc theo giọng Dave Trott

Dán toàn bộ nội dung dưới đây vào phiên mới.

---

Bạn đang làm việc trong repo `/Users/duyquang/Desktop/APP` (app Next.js "myCreative"). Hãy đọc `AGENTS.md` ở gốc repo trước. Mọi thứ bạn cần nằm trong prompt này và trong các file được nhắc tên, không cần hỏi lại tôi về bối cảnh.

## Mục tiêu

Tính năng **Góc Đọc** có 150 bài của Dave Trott (tiếng Anh) kèm bản dịch tiếng Việt. Tôi muốn dịch lại để **giống giọng văn, lối tư duy và nhịp điệu của Dave Trott nhất có thể**, và dịch thật xuất sắc. Đã dịch thử 5 bài, tôi sẽ cho biết giọng đó đúng hay cần chỉnh ở dưới.

## Dữ liệu

- Model `CreativeArticle` trong `prisma/schema.prisma`: `slug`, `originalTitle`, `originalLines` (Json), `titleVi`, `linesVi` (Json), `wordCount`.
- `originalLines` là mảng dòng: `{ "t": "câu chữ" }` hoặc `{ "gap": true }` (dòng trống). `linesVi` phải khớp **1:1** số dòng và vị trí `gap` với `originalLines`.
- Văn bản dùng markdown nhẹ: `**đậm**` (thường bọc câu trích dẫn) và `*nghiêng*`. Giữ đúng chỗ đậm/nghiêng như bản gốc.
- Bản dịch cũ do tôi làm nằm trong database và các file `scripts/translations/batch-N-output.json` (định dạng `{ slug: { titleVi, tags, linesVi } }`). `scripts/merge-translations.ts` ghi các file đó vào database.
- Bản dịch thử 5 bài: `scripts/translations/revised/pilot-5.input.json` (dạng dễ viết) và `pilot-5.json` (đã ghép). **Đọc file input này trước, đó là chuẩn giọng văn.** 5 slug: `the-ploughmans-advertising`, `i-never-picked-up-a-needle`, `the-award-for-best-hosepipe-ad-in-a-foreign-language`, `which-lie-to-believe`, `dont-regret-what-you-wish-youd-done`.

## Công cụ có sẵn

`npx tsx scripts/build-revised-translations.ts <input.json> <output.json>`

- Input: `{ "<slug>": { "titleVi": "TIÊU ĐỀ IN HOA", "vi": ["dòng chữ 1", "dòng chữ 2", ...] } }`. Mảng `vi` **chỉ gồm các dòng chữ theo thứ tự**; dòng trống do script tự chèn theo bài gốc. Bỏ `vi` nếu chỉ sửa tiêu đề.
- Script chỉ đọc database, kiểm tra số dòng, in đậm, con số, và ghi ra file đúng định dạng `batch-N-output.json`. Có lỗi thì không ghi file.
- Cảnh báo "số liệu lệch" có thể báo nhầm (ví dụ gốc viết "one", dịch viết "1"), kiểm tra bằng mắt.

## Giọng văn Dave Trott (quy tắc dịch)

1. **Câu ngắn, mỗi ý một nhịp.** Trott viết như nói, ngắt dòng liên tục. Tách câu dài khi nhịp bị chậm, giữ nguyên chỗ ông đã ngắt.
2. **Từ đời thường, không màu mè.** Không thêm tính từ hay thành ngữ mà bản gốc không có. Tránh các chữ kiểu "khô khốc", "tin sái cổ", "quỳ gối tôn sùng", "bán tháo", "chát chúa".
3. **Giữ phép lặp.** Khi ông lặp cấu trúc để dồn người đọc (ví dụ "I know… used to make ads" bảy lần), bản dịch lặp đủ số lần.
4. **Giữ cú chốt cuối bài thật gọn và sắc.** Đừng giải thích thêm.
5. **Giữ sự mỉa mai khô và thẳng thừng**, không làm nặng hơn hay nhẹ đi.
6. **Khẩu ngữ ở chỗ nhân vật nói** (ví dụ "ain't" thành "cóc phải"), còn lời dẫn thì trung tính.
7. **Bám bản gốc tuyệt đối về nội dung.** Không "sửa" kiến thức, số liệu hay lập luận của ông, kể cả khi ông sai hay lẫn lộn. Ví dụ bài "Which Lie to Believe" giữ "1 trên 2" đúng như ông viết. Nếu thấy nghi vấn thật sự, ghi vào báo cáo cuối thay vì tự sửa trong bản dịch.
8. Xưng hô: "tôi" cho "I"; "chúng ta/ta" cho "we"; nhân vật phản diện dùng tên riêng hoặc "ông ta"; khách hàng trong truyện dùng "anh/ông ấy".
9. Giữ nguyên tên riêng, tên tổ chức và thuật ngữ ngành quảng cáo bằng tiếng Anh theo thói quen dân ngành: agency, copywriter, art director, strategist, brief, CV, CEO… Tên tổ chức có bản dịch chuẩn thì dùng bản chuẩn, kèm tiếng Anh ở lần đầu nếu cần (ví dụ "Viện Hàn lâm Nghệ thuật và Khoa học Điện ảnh (Academy of Motion Picture Arts and Sciences)").
10. Đơn vị tiền, số: dùng dấu chấm ngăn nghìn kiểu Việt (9.500 bảng), giữ nguyên mọi con số.
11. **Tiêu đề**: IN HOA, dịch ý chứ không dịch từng chữ, không thêm ý. Tiêu đề là chỗ yếu nhất của bản cũ nên dành công cho nó.
12. **Tên sản phẩm có ký tự đặc biệt giữ thống nhất cả bài** (ví dụ "Gü" có dấu umlaut).
13. Với chuyện chơi chữ hoặc thành ngữ Anh không có tương đương, ưu tiên giữ ý và nhịp, và có thể giữ nguyên chữ Anh kèm nghĩa ngắn trong ngoặc ở lần đầu.

Lỗi hay gặp của bản cũ cần tránh: dịch sai thuật ngữ (raid thành "phi đội", caterers thành "hậu cần"), đảo thứ tự tên tổ chức, thêm sắc thái mạnh hơn bản gốc ("thao túng" cho "handle", "ghét" cho "don't like", "y hệt" cho "virtually the same"), tiêu đề tự thêm ý, và dùng chữ không nhất quán trong cùng một bài.

## Nguyên tắc UI của dự án (nếu động tới giao diện)

Không thêm dòng ghi chú hay hướng dẫn trong UI; tính năng phải tự giải thích.

## Cách làm, theo thứ tự

**Bước 1: Tiêu đề cho cả 150 bài** (rẻ, hiệu quả nhất).
- Đọc `slug`, `originalTitle`, `titleVi` hiện tại và một vài dòng đầu của mỗi bài để hiểu ý. Soạn tiêu đề mới theo quy tắc 11. 5 bài thử đã có tiêu đề mới, giữ nguyên.
- Làm theo đợt khoảng 30 tiêu đề, ghi vào `scripts/translations/revised/titles-N.input.json`, chạy script ra `titles-N.json`.
- **Dừng lại và đưa tôi bảng so sánh** (tiêu đề gốc, bản cũ, bản mới) để duyệt trước khi sang bước 2.

**Bước 2: Dịch lại trọn bài, theo đợt 10 bài.**
- Chọn đợt kế tiếp, đọc `originalLines` từng bài, dịch theo quy tắc, ghi `scripts/translations/revised/batch-R<N>.input.json`, chạy script ra `batch-R<N>.json`.
- Mỗi đợt xong, báo ngắn: số bài, cảnh báo còn lại, 2 đến 3 đoạn tiêu biểu trước/sau, và mọi chỗ bạn nghi bài gốc có sai. **Chờ tôi duyệt** rồi mới làm đợt tiếp. Tôi có thể dừng bất cứ lúc nào.
- Ưu tiên các bài sắp xuất bản, nếu xác định được từ `status` và `publishedDate` trong database.

**Bước 3 (chỉ khi tôi bảo): áp vào database.** Viết `scripts/apply-revised-translations.ts`, cập nhật `titleVi` và `linesVi` từ các file `revised/*.json` theo `slug`. **Bắt buộc**: sao lưu trước (xuất `slug, titleVi, linesVi` hiện có ra `scripts/translations/revised/backup-<ngày>.json`), chỉ áp lên database local trước, không đụng `status`, `tags`, `publishedDate`. Áp lên production là quyết định riêng của tôi.

## Ràng buộc

- **Không ghi đè bản dịch cũ, không ghi database, không commit, không push** trừ khi tôi bảo rõ. Mọi bản mới nằm trong `scripts/translations/revised/`.
- Không dùng `prisma migrate` hay `--shadow-database-url` với database thật (xem memory dự án).
- Chi phí: toàn bộ 145 bài còn lại khoảng 90.000 từ tiếng Anh, ước tính 4 đến 6 USD nếu làm trong phiên sạch. Nên giữ phiên này sạch, không đọc lại các file lớn không cần thiết, và dùng tác vụ con cho từng đợt nếu có thể.
- Trả lời tôi bằng tiếng Việt, ngắn gọn, nêu kết quả trước.

## Điều tôi muốn bạn hỏi lại tôi ngay đầu phiên (một câu duy nhất)

Hỏi tôi: giọng văn trong `pilot-5.input.json` đã đúng ý chưa, hay tôi muốn chỉnh gì (khô hơn, đời hơn, giữ thêm chút màu mè của bản cũ ở chỗ nào…). Nếu tôi nói "đúng rồi" thì bắt đầu Bước 1 luôn.
