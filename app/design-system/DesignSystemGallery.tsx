"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Download, PenTool, FileText, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import Brand from "@/components/Brand";
import { useInteraction } from "@/components/InteractionProvider";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel, Table, type Tone } from "@/components/ui/Presentation";
import { Dialog } from "@/components/ui/Dialog";
import { SignaturePad } from "@/components/SignaturePad";
import { WorkflowPrintView, type WorkflowPrintDocument } from "@/components/WorkflowPrintView";

const tones: Tone[] = ["neutral", "info", "success", "warning", "danger"];
const colors = [
  ["Thương hiệu", "--primary"], ["Nền", "--background"], ["Surface", "--surface"],
  ["Thông tin", "--info"], ["Thành công", "--success"], ["Cảnh báo", "--warning"], ["Lỗi", "--danger"],
];

export default function DesignSystemGallery() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sigPadOpen, setSigPadOpen] = useState(false);
  const [capturedSig, setCapturedSig] = useState<string | null>(null);
  const [capturedPin, setCapturedPin] = useState<string | null>(null);
  const [demoKind, setDemoKind] = useState<"PROPOSAL_ADVANCE" | "PROPOSAL_ADVANCE_SETTLEMENT">("PROPOSAL_ADVANCE");
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const { notify } = useInteraction();
  return <>
    <a href="#gallery" className="tf-ui-skip">Đến nội dung</a>
    <main id="gallery" className="tf-page tf-ui-gallery">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Brand />
        <Link href="/login" className="tf-button-secondary">Đến đăng nhập</Link>
      </header>
      <div>
        <p className="tf-ui-help">MYCREATIVE / UI FOUNDATION / V1</p>
        <h1 className="tf-page-title mt-2">Một ngôn ngữ, mọi thao tác.</h1>
        <p className="tf-ui-help">Nền giao diện dùng chung cho TaskFlow, CostFlow và Workflow. Dữ liệu bên dưới là ví dụ để xem mẫu.</p>
      </div>
      <nav aria-label="Các nhóm component" className="flex flex-wrap gap-3 text-sm underline">
        <a href="#tokens">Nền tảng</a><a href="#buttons">Thao tác</a>
        <a href="#fields">Biểu mẫu</a><a href="#status">Trạng thái</a><a href="#table">Bảng dữ liệu</a>
        <a href="#signing">Ký số & In A4 (WF-04)</a>
      </nav>
      <section id="tokens" aria-labelledby="tokens-title">
        <Panel>
          <h2 id="tokens-title" className="tf-ui-heading mb-4">Nền tảng</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            {colors.map(([label, token]) => <div key={token}>
              <div className="tf-ui-swatch" style={{ background: `var(${token})` }} />
              <p className="mt-2 text-sm font-semibold">{label}</p><p className="tf-ui-help">{token}</p>
            </div>)}
          </div>
          <div className="tf-ui-gallery-grid mt-6">
            <div><h3 className="font-semibold">Chữ & số</h3>
              <p className="tf-page-title mt-3">Tiêu đề trang · 30</p>
              <p className="tf-ui-heading mt-3">Tiêu đề vùng · 20</p>
              <p className="mt-3 text-sm">Nội dung · 14 — tiếng Việt có dấu rõ ràng.</p>
              <p className="tf-ui-help">Nhãn / hỗ trợ · 13</p>
            </div>
            <div><h3 className="font-semibold">Khoảng cách & hình khối</h3>
              <p className="tf-ui-help">4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 px</p>
              <p className="tf-ui-help">Control 7 / Panel 8 / Dialog 12 px. Mục tiêu chạm tối thiểu 44 px trên thiết bị cảm ứng.</p>
              <p className="tf-ui-help">Focus rõ, chuyển động nhẹ và tôn trọng reduced motion.</p>
            </div>
          </div>
        </Panel>
      </section>
      <section id="buttons" aria-labelledby="buttons-title">
        <Panel>
          <h2 id="buttons-title" className="tf-ui-heading mb-4">Thao tác & phản hồi</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => notify("Đã thử nút chính")}> <Plus size={16} aria-hidden="true" />Tạo hồ sơ</Button>
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>Mở hộp thoại</Button>
            <Button variant="danger" onClick={() => notify({ message: "Đây là ví dụ thao tác hủy", tone: "info" })}>Hủy hồ sơ</Button>
            <Button variant="ghost" onClick={() => notify({ message: "Xem lịch sử mẫu", tone: "info" })}>Xem lịch sử</Button>
            <IconButton variant="secondary" aria-label="Xem mẫu tải xuống" onClick={() => notify({ message: "Đây là nút tải mẫu", tone: "info" })}><Download size={16} aria-hidden="true" /></IconButton>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="sm">Nhỏ</Button><Button size="md">Vừa</Button><Button size="lg">Lớn</Button>
            <Button disabled>Chưa thể gửi</Button><Button loading loadingLabel="Đang lưu…">Lưu</Button>
          </div>
        </Panel>
      </section>
      <section id="fields" aria-labelledby="fields-title">
        <Panel>
          <h2 id="fields-title" className="tf-ui-heading mb-4">Biểu mẫu</h2>
          <form onSubmit={(event) => { event.preventDefault(); setSubmitted(true);
            if (name.trim()) notify("Dữ liệu mẫu hợp lệ"); }} noValidate>
            <div className="tf-ui-gallery-grid">
              <Input label="Tên hồ sơ" required value={name} onChange={(event) => setName(event.target.value)}
                placeholder="Nhập tên hồ sơ" hint="Tên giúp người xử lý nhận ra hồ sơ."
                error={submitted && !name.trim() ? "Vui lòng nhập tên hồ sơ." : undefined} />
              <Select label="Loại hồ sơ" defaultValue="proposal"><option value="proposal">Tờ trình</option><option value="contract">Hợp đồng</option></Select>
              <Input label="Người xử lý" value="Chưa phân công" disabled hint="Trạng thái disabled." />
              <Input label="Phiên bản" value="v1.0 — mẫu" readOnly hint="Trạng thái chỉ đọc." />
              <Textarea label="Ghi chú" placeholder="Bổ sung thông tin cho người xử lý" />
              <Input label="Mã tham chiếu" defaultValue="" error="Ví dụ lỗi: mã tham chiếu còn thiếu." />
            </div>
            <div className="tf-ui-actions mt-5"><Button type="submit">Kiểm tra biểu mẫu</Button></div>
          </form>
        </Panel>
      </section>
      <section id="status" aria-labelledby="status-title">
        <Panel>
          <h2 id="status-title" className="tf-ui-heading mb-4">Trạng thái có tên, có ngữ cảnh</h2>
          <div className="flex flex-wrap gap-3 mb-5">{tones.map((tone, index) => <Badge tone={tone} key={tone}>{["Nháp", "Chờ xử lý", "Đã xác nhận", "Cần bổ sung", "Từ chối"][index]}</Badge>)}</div>
          <div className="tf-ui-gallery-grid">
            <Alert tone="warning" title="Bạn đồng thời là người lập và người duyệt">Mỗi bước vẫn cần một quyết định riêng.</Alert>
            <Alert tone="info" title="Đã duyệt không đồng nghĩa đã trả tiền">Giao dịch thực tế cần căn cứ và xác nhận riêng.</Alert>
            <Alert tone="success" title="Đã lưu dữ liệu mẫu">Thông báo thành công có nội dung cụ thể.</Alert>
            <Alert tone="danger" title="Chưa thể gửi hồ sơ">Kiểm tra các trường có lỗi bên trên.</Alert>
          </div>
        </Panel>
      </section>
      <section id="table" aria-labelledby="table-title">
        <Panel>
          <h2 id="table-title" className="tf-ui-heading mb-4">Hồ sơ & số liệu</h2>
          <Table caption="Ví dụ hiển thị — dữ liệu giả lập, không phải hồ sơ thật" hideCaption>
            <thead><tr><th scope="col">Hồ sơ / phiên bản</th><th scope="col">Ngân sách</th><th scope="col">CEO</th><th scope="col">Tiền thực tế</th><th scope="col">Ký giấy</th><th scope="col" className="tf-ui-number">Giá trị mẫu (VND)</th></tr></thead>
            <tbody><tr><th scope="row">IC-MẪU / v2</th><td><Badge tone="success">Có hiệu lực</Badge></td><td><Badge tone="danger">Từ chối</Badge></td><td>Chưa ghi nhận</td><td>Chưa ký</td><td className="tf-ui-number">12.000.000 ₫</td></tr>
              <tr><th scope="row">ĐNTT-MẪU / v1</th><td>—</td><td><Badge tone="info">Chờ duyệt</Badge></td><td>Chưa ghi nhận</td><td>Chưa ký</td><td className="tf-ui-number">3.000.000 ₫</td></tr></tbody>
          </Table>
          <p className="tf-ui-help">IC giữ hiệu lực sau Quản lý dù CEO từ chối. Phiếu chi cần quyền thanh toán riêng. Trên mobile, cuộn trong bảng để xem các cột.</p>
        </Panel>
      </section>
      <section id="signing" aria-labelledby="signing-title">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <h2 id="signing-title" className="tf-ui-heading flex items-center gap-2">
                <Sparkles size={18} className="text-brand-600" aria-hidden="true" />
                Ký số & Trình ký số nội bộ (WF-04 Paperwork)
              </h2>
              <p className="tf-ui-help mt-1">
                Chuẩn ERPNext OSS: Canvas vẽ tay, chữ ký mẫu cá nhân, upload ảnh tách nền, mã băm SHA-256 và bản in A4 nhúng mã QR.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setSigPadOpen(true)}>
                <PenTool size={16} aria-hidden="true" />
                Mở SignaturePad thử nghiệm
              </Button>
            </div>
          </div>

          {/* Captured signature preview card */}
          {capturedSig && (
            <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 size={15} className="text-emerald-600" aria-hidden="true" />
                  Đã ghi nhận chữ ký & xác thực PIN 6 số thành công từ SignaturePad
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCapturedSig(null);
                    setCapturedPin(null);
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-800 underline"
                >
                  Xóa chữ ký thử nghiệm
                </button>
              </div>
              <div className="flex items-center gap-4 pt-1">
                <div className="h-16 w-44 rounded border border-zinc-200 bg-white p-2 shadow-inner flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={capturedSig} alt="Chữ ký đã thử nghiệm" className="max-h-full max-w-full object-contain" />
                </div>
                <div className="text-xs text-zinc-600 space-y-1">
                  <p><strong>Mã băm toàn vẹn:</strong> <code className="font-mono text-zinc-800">sha256:4a8b9f...e10d</code></p>
                  <p><strong>Bảo mật cấp 2:</strong> <span className="font-mono text-emerald-800 font-semibold">Đã xác nhận PIN 6 số (••••••)</span></p>
                  <p>Đã tự động cập nhật vào khối chữ ký người đề nghị trong bản in mẫu bên dưới.</p>
                </div>
              </div>
            </div>
          )}

          {/* Switcher for Print Template Preview */}
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-700">
              <span>Mẫu biểu chuẩn hóa:</span>
              <button
                type="button"
                onClick={() => setDemoKind("PROPOSAL_ADVANCE")}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  demoKind === "PROPOSAL_ADVANCE"
                    ? "bg-white font-bold text-zinc-950 shadow-sm border border-zinc-200"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                1. Đề nghị tạm ứng (ĐNTU-CS.2026)
              </button>
              <button
                type="button"
                onClick={() => setDemoKind("PROPOSAL_ADVANCE_SETTLEMENT")}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  demoKind === "PROPOSAL_ADVANCE_SETTLEMENT"
                    ? "bg-white font-bold text-zinc-950 shadow-sm border border-zinc-200"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                2. Hoàn tạm ứng (ĐNHTU-CS.2026)
              </button>
            </div>

            <div className="text-xs text-zinc-500">
              Bản in A4 tích hợp QR Code xác minh công khai
            </div>
          </div>

          {/* Interactive Print View Embed */}
          <div className="rounded-xl border border-zinc-200 overflow-hidden bg-zinc-100 shadow-inner">
            <WorkflowPrintView
              doc={{
                code: demoKind === "PROPOSAL_ADVANCE" ? "ĐNTU-CS.2026-009" : "ĐNHTU-CS.2026-004",
                title: demoKind === "PROPOSAL_ADVANCE"
                  ? "Đề nghị tạm ứng chi phí tổ chức Teambuilding Hè 2026 tại Đà Nẵng"
                  : "Hoàn tạm ứng chi phí tổ chức Teambuilding Hè 2026",
                kind: demoKind,
                approvedAt: new Date().toISOString(),
                creatorName: "Võ Phạm Trọng Huy",
                amount: "25000000",
                content: "Chi phí thuê âm thanh, ánh sáng, backdrop sân khấu và đặt cọc xe đưa đón nhân viên theo kế hoạch đã được phê duyệt.",
                financeLines: demoKind === "PROPOSAL_ADVANCE_SETTLEMENT" ? [{ id: "demo-line", description: "Tổng thực chi theo snapshot minh họa", amount: "26850000" }] : [],
                signatures: [
                  { role: "CREATOR", name: "Võ Phạm Trọng Huy", signedAt: "2026-10-09T08:30:00.000Z" },
                  { role: "MANAGER", name: "Bùi Duy Quang", signedAt: "2026-10-09T09:15:00.000Z" },
                  { role: "ACCOUNTANT", name: "Đỗ Vũ Phương Uyên", signedAt: "2026-10-09T10:00:00.000Z" },
                  { role: "CEO", name: "Đoàn Thái Sơn", signedAt: "2026-10-09T11:20:00.000Z" },
                ],
                projectionSha256: "7e8a9d1b4c3f2e0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a",
                signingMode: "DIGITAL",
                isDraft: false,
              }}
              backHref="#signing"
            />
          </div>
        </Panel>
      </section>

      <Panel><EmptyState title="Chưa có chứng từ" description="Khi có chứng từ, danh sách và phiên bản sẽ xuất hiện tại đây." action={<Button variant="secondary" onClick={() => notify({ message: "Ví dụ empty state; không tải file lên", tone: "info" })}>Xem thao tác mẫu</Button>} /></Panel>
      <footer className="tf-ui-help">UI Foundation v1 · Các mẫu không ghi dữ liệu nghiệp vụ.</footer>
    </main>

    {/* Interactive SignaturePad Dialog */}
    <SignaturePad
      open={sigPadOpen}
      onClose={() => setSigPadOpen(false)}
      onConfirm={(dataUrl, pin) => {
        setCapturedSig(dataUrl);
        setCapturedPin(pin ?? null);
        setSigPadOpen(false);
        notify({ message: "Đã thu nhận chữ ký số & xác thực mã PIN 6 số thành công!", tone: "success" });
      }}
      userName="Võ Phạm Trọng Huy"
      userRoleTitle="Người đề nghị"
    />
    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Xác nhận thao tác mẫu"
      description="Bạn có thể đóng bằng Escape hoặc nút Đóng."
      footer={<><Button variant="secondary" onClick={() => setDialogOpen(false)}>Quay lại</Button><Button onClick={() => { setDialogOpen(false); notify("Đã xác nhận thao tác mẫu"); }}>Xác nhận</Button></>}>
      <p className="text-sm">Bàn phím giữ focus trong hộp thoại và quay về nút mở khi đóng.</p>
    </Dialog>
  </>;
}
