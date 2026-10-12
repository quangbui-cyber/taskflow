"use client";

import { useState } from "react";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Input, Select, Textarea } from "./ui/Field";
import { Alert } from "./ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import { applyParameterImpact, previewParameterImpact, type ParameterImpactPreview, type QuotationParameterSnapshot } from "@/lib/costflow/quotationParameters";
import type { PairedRow } from "@/lib/costflow/types";
import { Sparkles, SlidersHorizontal, FileText, CheckCircle2 } from "lucide-react";

const EVENT_TYPES = ["Teambuilding", "Conference", "Gala", "Activation", "Exhibition", "Production", "Custom mixed"];

type Client = { id: string; name: string };

export default function QuotationSettingsDrawer({
  open,
  onClose,
  title,
  onTitle,
  clientId,
  onClientId,
  clients,
  notes,
  onNotes,
  rows,
  parameterConfig,
  onApply,
  disabled = false
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  onTitle: (value: string) => void;
  clientId: string;
  onClientId: (value: string) => void;
  clients: Client[];
  notes: string;
  onNotes: (value: string) => void;
  rows: PairedRow[];
  parameterConfig?: QuotationParameterSnapshot;
  onApply: (rows: PairedRow[], parameterConfig: QuotationParameterSnapshot) => void;
  disabled?: boolean;
}) {
  const [proposed, setProposed] = useState<QuotationParameterSnapshot | undefined>(
    parameterConfig ? structuredClone(parameterConfig) : undefined
  );
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftClientId, setDraftClientId] = useState(clientId);
  const [draftNotes, setDraftNotes] = useState(notes);
  const [impact, setImpact] = useState<ParameterImpactPreview | null>(null);
  const [error, setError] = useState("");

  const metadataDirty = draftTitle !== title || draftClientId !== clientId || draftNotes !== notes;
  const parametersDirty = !!parameterConfig && !!proposed && JSON.stringify(parameterConfig) !== JSON.stringify(proposed);

  const propose = (next: QuotationParameterSnapshot) => {
    setProposed(next);
    setImpact(null);
    setError("");
  };

  const preview = () => {
    if (!parameterConfig || !proposed) return;
    try {
      setImpact(previewParameterImpact(rows, parameterConfig, proposed));
    } catch (cause) {
      setImpact(null);
      setError((cause as Error).message);
    }
  };

  const cancel = () => {
    setDraftTitle(title);
    setDraftClientId(clientId);
    setDraftNotes(notes);
    setProposed(parameterConfig ? structuredClone(parameterConfig) : undefined);
    setImpact(null);
    setError("");
  };

  const close = () => {
    cancel();
    onClose();
  };

  const apply = () => {
    if (!parameterConfig || !impact) return;
    try {
      const result = applyParameterImpact(rows, parameterConfig, impact);
      onApply(result.rows, result.parameterConfig);
      setImpact(null);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const saveMetadata = () => {
    onTitle(draftTitle);
    onClientId(draftClientId);
    onNotes(draftNotes);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Thiết lập báo giá"
      description="Cấu hình thông tin chung, tham số định giá tự động và điều khoản cho khách hàng."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Đóng
          </Button>
          {(metadataDirty || parametersDirty) && (
            <Button variant="secondary" disabled={disabled} onClick={cancel}>
              Hủy thay đổi
            </Button>
          )}
          <Button variant="secondary" disabled={!metadataDirty || disabled} onClick={saveMetadata}>
            Lưu thiết lập
          </Button>
          <Button disabled={!impact || disabled} onClick={apply}>
            Áp dụng thay đổi ({impact?.affected.length ?? 0} dòng)
          </Button>
        </>
      }
    >
      <div className="tf-quotation-settings-panel">
        <fieldset disabled={disabled} className="tf-quotation-settings space-y-6">
          {/* SECTION 1: THÔNG TIN CHUNG & KHÁCH HÀNG */}
          <section className="space-y-3 pb-5 border-b border-[var(--border)]">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
              <FileText size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
              <h3>1. Thông tin chung & Khách hàng</h3>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <Input
                label="Tên báo giá"
                placeholder="Nhập tên báo giá…"
                value={draftTitle}
                onChange={event => setDraftTitle(event.target.value)}
              />
              <Select
                label="Khách hàng nhận báo giá"
                value={draftClientId}
                onChange={event => setDraftClientId(event.target.value)}
              >
                <option value="">Chọn khách hàng…</option>
                {clients.map(client => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            </div>
          </section>

          {/* SECTION 2: THAM SỐ & TÁC ĐỘNG GIÁ */}
          <section className="space-y-3 pb-5 border-b border-[var(--border)]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                <SlidersHorizontal size={16} className="text-[var(--color-brand-700)]" aria-hidden="true" />
                <h3>2. Tham số & Tác động giá</h3>
              </div>
              {parameterConfig && (
                <span className="text-xs text-[var(--color-brand-700)] bg-[var(--primary-soft)] px-2 py-0.5 rounded font-medium border border-[var(--color-brand-300)] flex items-center gap-1">
                  <Sparkles size={11} aria-hidden="true" /> Định giá theo tham số
                </span>
              )}
            </div>

            {!proposed || !parameterConfig ? (
              <Alert title="Báo giá nhập tay">
                Báo giá này không áp dụng cấu hình tham số. Toàn bộ dòng chi phí và giá bán được nhập trực tiếp trên bảng.
              </Alert>
            ) : (
              <div className="space-y-4">
                {/* Shared Parameters */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Tham số chung sự kiện
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    {proposed.definitions
                      .filter(definition => definition.scope === "SHARED")
                      .map(definition => (
                        <Input
                          key={definition.key}
                          label={definition.label}
                          inputMode="decimal"
                          value={proposed.sharedValues[definition.key] ?? ""}
                          onChange={event =>
                            propose({
                              ...proposed,
                              sharedValues: {
                                ...proposed.sharedValues,
                                [definition.key]: event.target.value
                              }
                            })
                          }
                        />
                      ))}
                  </div>
                </div>

                {/* Modules Specific Overrides */}
                {proposed.modules.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                      Ghi đè theo Module
                    </h4>
                    <div className="space-y-2">
                      {proposed.modules.map(module => (
                        <details
                          key={module.id}
                          className="border border-[var(--border)] rounded-md bg-[var(--surface-soft)] p-3 text-xs"
                        >
                          <summary className="font-semibold text-[var(--foreground)] cursor-pointer flex items-center justify-between">
                            <span>{module.label}</span>
                            <span className="text-[var(--text-secondary)] font-normal">
                              {module.eventType || "Custom mixed"}
                            </span>
                          </summary>
                          <div className="mt-3 space-y-3 pt-3 border-t border-[var(--border)]">
                            <Select
                              label={`Loại sự kiện · ${module.label}`}
                              value={module.eventType || "Custom mixed"}
                              onChange={event =>
                                propose({
                                  ...proposed,
                                  modules: proposed.modules.map(item =>
                                    item.id === module.id ? { ...item, eventType: event.target.value } : item
                                  )
                                })
                              }
                            >
                              {EVENT_TYPES.map(type => (
                                <option key={type} value={type}>
                                  {type}
                                </option>
                              ))}
                            </Select>
                            {proposed.definitions.map(definition => (
                              <Input
                                key={definition.key}
                                label={`${definition.label} riêng cho ${module.label}`}
                                inputMode="decimal"
                                placeholder={proposed.sharedValues[definition.key] || definition.defaultValue}
                                value={module.overrides[definition.key] ?? ""}
                                onChange={event =>
                                  propose({
                                    ...proposed,
                                    modules: proposed.modules.map(item =>
                                      item.id === module.id
                                        ? { ...item, overrides: { ...item.overrides, [definition.key]: event.target.value } }
                                        : item
                                    )
                                  })
                                }
                              />
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-end">
                  <Button variant="secondary" size="sm" disabled={!parametersDirty || disabled} onClick={preview}>
                    Xem tác động
                  </Button>
                </div>
              </div>
            )}

            {/* PREVIEW IMPACT DIFF */}
            {error && <Alert tone="danger" title={error} />}
            {impact && (
              <section className="mt-4 p-3 bg-[var(--surface-soft)] border border-[var(--border)] rounded-lg space-y-3" aria-live="polite">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-[var(--foreground)] flex items-center gap-1.5">
                      <CheckCircle2 size={14} className="text-[var(--success)]" aria-hidden="true" /> Tác động dự kiến
                    </h4>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {impact.affected.length} giá trị sẽ thay đổi khi áp dụng.
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <div>
                      Bán: <strong className="font-mono tabular-nums text-[var(--success)]">{displayMoney(impact.oldTotals.sell.gross)} → {displayMoney(impact.newTotals.sell.gross)}</strong>
                    </div>
                    <div>
                      Vốn: <strong className="font-mono tabular-nums text-[var(--info)]">{displayMoney(impact.oldTotals.buy.gross)} → {displayMoney(impact.newTotals.buy.gross)}</strong>
                    </div>
                  </div>
                </div>

                {impact.issues.length > 0 && (
                  <Alert tone="warning" title="Công thức chưa tính được">
                    {impact.issues.map(issue => (
                      <p key={`${issue.rowId}-${issue.side}-${issue.field}`}>
                        {issue.rowName || issue.rowId}: {issue.message}
                      </p>
                    ))}
                  </Alert>
                )}

                <div className="max-h-48 overflow-y-auto border border-[var(--border)] rounded bg-[var(--surface)] text-xs">
                  <table className="w-full border-collapse">
                    <caption className="sr-only">Chi tiết các dòng bị tác động bởi thay đổi tham số</caption>
                    <thead className="bg-[var(--surface-soft)] border-b border-[var(--border)] text-[var(--text-secondary)]">
                      <tr>
                        <th className="p-1.5 text-left font-semibold">Hạng mục</th>
                        <th className="p-1.5 text-center font-semibold">Phía</th>
                        <th className="p-1.5 text-center font-semibold">Trường</th>
                        <th className="p-1.5 text-right font-semibold">Cũ</th>
                        <th className="p-1.5 text-right font-semibold">Mới</th>
                      </tr>
                    </thead>
                    <tbody>
                      {impact.affected.map(change => (
                        <tr key={`${change.rowId}-${change.side}-${change.field}`} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-soft)]">
                          <td className="p-1.5 truncate max-w-[140px]" title={change.rowName || change.rowId}>
                            {change.rowName || change.rowId}
                          </td>
                          <td className="p-1.5 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${change.side === "sell" ? "bg-[var(--primary-soft)] text-[var(--color-brand-800)]" : "bg-[var(--info-soft)] text-[var(--info)]"}`}>
                              {change.side === "sell" ? "Bán" : "IC"}
                            </span>
                          </td>
                          <td className="p-1.5 text-center text-[var(--text-secondary)]">
                            {change.field === "quantity" ? "Số lượng" : change.field === "days" ? "Số ngày" : "Đơn giá"}
                          </td>
                          <td className="p-1.5 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                            {change.oldValue || "—"}
                          </td>
                          <td className="p-1.5 text-right font-mono tabular-nums font-semibold text-[var(--foreground)]">
                            {change.newValue || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </section>

          {/* SECTION 3: TÙY CHỌN BẢN KHÁCH & ĐIỀU KHOẢN */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
              <FileText size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
              <h3>3. Tùy chọn bản khách & Điều khoản</h3>
            </div>
            <Textarea
              label="Ghi chú & Điều khoản chung cho khách hàng"
              placeholder="Nhập điều khoản thanh toán, hiệu lực báo giá, ghi chú chân trang…"
              rows={4}
              value={draftNotes}
              onChange={event => setDraftNotes(event.target.value)}
            />
            <p className="text-xs text-[var(--text-secondary)]">
              Nội dung này sẽ xuất hiện ở phần chân trang trong bản in và file PDF gửi cho khách hàng.
            </p>
          </section>
        </fieldset>
      </div>
    </Dialog>
  );
}
