"use client";

import { useState } from "react";
import { LockKeyhole, RotateCcw } from "lucide-react";
import ActionForm from "@/components/CostFlowActionForm";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Field";
import { Alert, Badge, Panel } from "@/components/ui/Presentation";

export default function FinancialCloseModal({ finance, blockers, hasDossier, canRequest }: {
  finance: Finance;
  blockers: string[];
  hasDossier: boolean;
  canRequest: boolean;
}) {
  const [open, setOpen] = useState(false);
  const reopening = finance.data.closed;
  const command = reopening ? "REQUEST_REOPEN_PROJECT" : "REQUEST_CLOSE_PROJECT";
  const closeBlocked = !reopening && blockers.length > 0;
  return <Panel className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2">{reopening ? <RotateCcw size={18} aria-hidden="true" /> : <LockKeyhole size={18} aria-hidden="true" />}<div><h3 className="font-bold">{reopening ? "Mở lại tài chính" : "Đóng tài chính"}</h3><p className="text-xs text-[var(--text-secondary)]">Yêu cầu và quyết định Quản lý là trục riêng; Task DONE hoặc ký không tự đóng tài chính.</p></div></div>
      <Badge tone={reopening ? "neutral" : closeBlocked ? "warning" : "success"}>{reopening ? "Tài chính đã đóng" : closeBlocked ? `${blockers.length} điều kiện chưa đạt` : "Đủ hai chiều"}</Badge>
    </div>
    {!reopening && blockers.length > 0 && <Alert tone="danger" title="Chưa thể gửi yêu cầu đóng tài chính"><ul className="list-disc pl-5">{blockers.map(item => <li key={item}>{item}</li>)}</ul></Alert>}
    <Button className="min-h-11" disabled={!canRequest || !hasDossier || closeBlocked} onClick={() => setOpen(true)}>{reopening ? "Gửi yêu cầu mở lại tài chính" : "Gửi yêu cầu đóng tài chính"}</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title={reopening ? "Gửi yêu cầu mở lại tài chính" : "Gửi yêu cầu đóng tài chính"} description="Máy chủ sẽ kiểm tra lại Project, actor, phiên bản và mọi điều kiện ngay lúc gửi.">
      {reopening && <Alert tone="warning" title="Chuẩn B02 — lịch sử không bị sửa">
        Mở lại bảo toàn 100% hồ sơ, dòng đã quyết toán, khóa, tiền, file xuất, chữ ký và mã băm cũ. Project luôn dùng một hồ sơ quyết toán ổn định; nguồn AC mới được DD duyệt chỉ tạo version/attempt bất biến mới. Thay đổi giá trị đã chi hoặc đã khóa vẫn bị chặn cho đến khi có quyết định nghiệp vụ riêng.
      </Alert>}
      {!reopening && <Alert tone="success" title="Đã thỏa mãn đầy đủ điều kiện đóng tài chính">Cả đối soát nội bộ và doanh thu khách hàng đã đạt điều kiện kỹ thuật tại lần tải trang này.</Alert>}
      <div className="mt-4 [&_button]:min-h-11">
        <ActionForm finance={finance} command={command} label={reopening ? "Xác nhận gửi Quản lý duyệt mở lại" : "Xác nhận gửi Quản lý duyệt đóng"} onSuccess={() => setOpen(false)}>
          <Textarea name="reason" label={reopening ? "Lý do cần mở lại tài chính" : "Lý do / Giải trình đề nghị đóng tài chính"} required />
        </ActionForm>
      </div>
    </Dialog>
  </Panel>;
}
