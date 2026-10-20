"use client";

import { useActionState, useMemo, useState } from "react";
import { actualCostAction, type ActualCostActionState } from "@/app/actions/costflow";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Presentation";
import { ACTUAL_COST_PASTE_COLUMNS, parseActualCostPaste } from "@/lib/costflow/actualCostPaste";

export default function ActualCostPastePreview({ finance, onClose }: { finance: Finance; onClose: () => void }) {
  const [text, setText] = useState("");
  const [submittedText, setSubmittedText] = useState<string | null>(null);
  const [state, action, pending] = useActionState(actualCostAction, {} as ActualCostActionState);
  const revision = finance.data.revisions.find(item => item.effective);
  const recipients = useMemo(() => [
    ...finance.project.members.map(member => ({ key: `USER:${member.userId}`, label: finance.users.find(user => user.id === member.userId)?.name ?? "" })),
    ...finance.data.beneficiaries.map(vendor => ({ key: `VENDOR:${vendor.id}`, label: vendor.name })),
    ...finance.suppliers.flatMap(supplier => supplier.accounts.map(account => ({ key: account.recipientKey, label: `${supplier.version.legalName} · ${account.bankName} •••• ${account.accountLast4}` }))),
  ], [finance]);

  const preview = useMemo(() => parseActualCostPaste(text, revision, recipients), [text, revision, recipients]);

  return <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3" aria-label="Dán nhiều khoản thực chi từ Excel">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">Dán nhiều khoản thực chi</h3>
      <Button variant="secondary" size="sm" onClick={onClose}>Đóng bảng dán</Button>
    </div>
    <p className="text-xs text-[var(--text-secondary)]">Sao chép 11 cột theo đúng thứ tự dưới đây từ Excel. Dòng đầu là tiêu đề hoặc dữ liệu; mỗi lần tối đa 100 khoản. Kiểm tra toàn bộ bảng xem trước rồi mới lưu vào bản nháp Bảng AC. Dán dữ liệu không gửi duyệt.</p>
    <p className="text-xs font-medium break-words">{ACTUAL_COST_PASTE_COLUMNS.join(" · ")}</p>
    <p className="text-xs text-[var(--text-secondary)]">Loại: IC hoặc Ngoài IC. Hạng mục IC và người nhận/NCC phải trùng tên đang hiển thị trong Project. Nguồn tiền: Tạm ứng nhân sự, Nhân sự tự chi, Tạm ứng NCC hoặc Thanh toán NCC. Số tiền nhập theo NET.</p>
    <label className="block text-xs font-medium">Dữ liệu từ Excel
      <textarea value={text} onChange={event => setText(event.target.value)} rows={5} className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs" placeholder={ACTUAL_COST_PASTE_COLUMNS.join("\t")} />
    </label>
    {preview.tooMany && <Alert tone="danger" title="Quá 100 khoản. Hãy chia thành nhiều lần dán." />}
    {preview.rows.length > 0 && <div className="max-h-72 overflow-auto rounded-lg border border-[var(--border)]" role="region" aria-label="Xem trước dữ liệu dán">
      <table className="min-w-full text-xs text-left">
        <thead className="bg-[var(--primary)] text-[var(--color-brand-900)] font-semibold"><tr><th className="p-2">Dòng</th><th className="p-2">Nội dung</th><th className="p-2">Hạng mục</th><th className="p-2">Người nhận</th><th className="p-2">Kiểm tra</th></tr></thead>
        <tbody>{preview.rows.map(row => <tr key={row.number} className="border-t border-[var(--border)] align-top">
          <td className="p-2">{row.number}</td><td className="p-2">{row.line.description || "—"}</td><td className="p-2">{row.cells[1] || "Ngoài IC"}</td><td className="p-2">{row.cells[3] || "—"}</td>
          <td className={`p-2 ${row.errors.length ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>{row.errors.length ? row.errors.join(" ") : "Sẵn sàng lưu"}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    <form action={action} onSubmit={() => setSubmittedText(text)}>
      <input type="hidden" name="projectId" value={finance.project.id} />
      <input type="hidden" name="actualCostCommand" value="SAVE_LINES" />
      <input type="hidden" name="revisionId" value={revision?.id ?? ""} />
      <input type="hidden" name="sheetRevisionId" value={finance.actualCosts?.sheet?.revisionId ?? ""} />
      <input type="hidden" name="sheetMutationVersion" value={finance.actualCosts?.sheet?.mutationVersion ?? 0} />
      <input type="hidden" name="lines" value={preview.ready ? JSON.stringify(preview.rows.map(row => row.line)) : ""} />
      <Button type="submit" size="sm" disabled={!preview.ready || !revision || (Boolean(state.success) && submittedText === text)} loading={pending}>Lưu {preview.rows.length} khoản vào bản nháp</Button>
    </form>
    {state.error && <Alert tone="danger" title={state.error} />}
    {state.success && <Alert tone="success" title={state.success} />}
  </section>;
}
