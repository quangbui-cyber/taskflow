# Killer Sudoku trong myCreative

Thêm lựa chọn **Sudoku thường / Killer Sudoku** tại `/sudoku`, cho chơi một mình và phòng thi đấu online. Giao diện, lưu ván, bàn phím, gợi ý, ghi chú và giới hạn lỗi dùng chung với Sudoku hiện có. Đổi loại khi đang chơi một mình cần xác nhận bắt đầu ván mới. Kỷ lục Killer lưu riêng theo độ khó, các ván Sudoku cũ vẫn khôi phục như trước.

## Luật và sinh đề

- Bắt đầu bằng 81 ô trống. Mỗi vùng nét đứt có tổng ở ô đầu tiên theo thứ tự hàng/cột.
- Vùng gồm các ô liền cạnh, không lặp chữ số; các luật hàng, cột và khối 3×3 vẫn áp dụng.
- Từ một lời giải Sudoku hợp lệ, bộ sinh gộp dần các vùng liền nhau, tối đa 5 ô, chỉ giữ phép gộp khi đã chứng minh còn đúng một lời giải. Mục tiêu số vùng: 44 / 39 / 34 / 29 cho Dễ / Vừa / Khó / Chuyên gia. Đây là mức cấu trúc đề, chưa phải thang đánh giá độ khó bằng kỹ thuật suy luận của con người.
- Bộ giải dùng ứng viên theo hàng/cột/khối và tổ hợp tổng vùng. Tìm kiếm có giới hạn; nếu hết ngân sách thì không chứng nhận đề là duy nhất và bỏ phép gộp đó. Đề có thể giữ nhiều vùng hơn mục tiêu.
- Khi chọn ô, bảng phụ hiện tổng còn thiếu. Điền đúng cũng xoá ghi chú số đó trong cùng vùng, kể cả các ô khác hàng/cột/khối.

Tham khảo ý tưởng vùng tổng và trải nghiệm Classic/Killer của [Svudoku](https://github.com/fodor-lori/svudoku), bản nguồn `088e858`. Phần triển khai dùng React/Next.js và logic Sudoku của myCreative; không đưa runtime Svelte vào ứng dụng.

## Dữ liệu và triển khai

Migration `20261106100000_add_killer_sudoku` thêm `SudokuGame.variant` (mặc định `classic`) và `SudokuGame.cages` (JSONB). Phòng cũ mặc định tiếp tục là Sudoku thường. API gửi vùng gồm chỉ số ô và tổng, không gửi lời giải. Luật chấm nước đi, thời gian, lỗi và kết quả vẫn được máy chủ xử lý. Bảng xếp hạng online hiện gộp cả hai loại Sudoku.

Triển khai migration trước khi chạy mã mới bằng quy trình triển khai hiện có (`prisma migrate deploy`), rồi sinh Prisma Client và build ứng dụng. **Không có migration nào được chạy vào cơ sở dữ liệu thật trong phiên phát triển này.**

## Kiểm tra

- `node --import tsx --test tests/killerSudoku.test.ts tests/killerSudokuOnline.test.ts tests/sudoku.test.ts`
- `node node_modules/typescript/bin/tsc --noEmit`
- ESLint các tệp thay đổi.
- Kiểm tra trình duyệt: chuyển loại, ghi chú/hoàn tác, bàn phím, tải lại ván đang chơi, gợi ý ô cuối và hoàn thành đề; màn hình rộng 390px không tràn ngang.

Kiểm thử phòng online chạy mã server action thật với lớp xác thực/Prisma giả lập trong bộ nhớ: cùng đề cho hai người, giữ kín lời giải, ba lỗi dẫn đến thua, ghi thắng một lần và chống cài đặt ghi đè ván vừa bắt đầu. Chưa chạy phòng hai tài khoản trên PostgreSQL thật.
