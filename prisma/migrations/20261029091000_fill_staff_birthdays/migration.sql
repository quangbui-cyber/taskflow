-- Điền sẵn sinh nhật cho nhân viên theo danh sách chủ sản phẩm gửi.
-- Chỉ lưu ngày/tháng (năm cố định 2000, xem lib/birthdays.ts); không ghi đè
-- ngày sinh người dùng đã tự khai. Email không có trong hệ thống thì bỏ qua.
UPDATE "User" AS u
SET "birthday" = b.birthday
FROM (VALUES
  ('nhi.le@creativestation.vn', DATE '2000-11-09'),
  ('dang.nguyen@creativestation.vn', DATE '2000-05-18'),
  ('mai.nguyen@creativestation.vn', DATE '2000-08-15'),
  ('nguyenhanhnguyen1448@gmail.com', DATE '2000-11-29'),
  ('tin.nguyen@creativestation.vn', DATE '2000-12-28'),
  ('nhung.pham@creativestation.vn', DATE '2000-01-23'),
  ('anh.nlb@creativestation.vn', DATE '2000-10-18'),
  ('dang.le@creativestation.vn', DATE '2000-04-23'),
  ('tram.truong@creativestation.vn', DATE '2000-08-04'),
  ('tu.nguyen@creativestation.vn', DATE '2000-08-16'),
  ('tung.truong@creativestation.vn', DATE '2000-06-24'),
  ('anh.bui@creativestation.vn', DATE '2000-11-10'),
  ('quang.bui@creativestation.vn', DATE '2000-09-23'),
  ('luan.chau@creativestation.vn', DATE '2000-05-03'),
  ('uyen.do@creativestation.vn', DATE '2000-07-28'),
  ('trinh.mai@creativestation.vn', DATE '2000-07-10'),
  ('son.doanthai@creativestation.vn', DATE '2000-10-02')
) AS b(email, birthday)
WHERE lower(u."email") = b.email
  AND u."birthday" IS NULL;
