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
