"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAiFindings, resolveAiFinding } from "@/app/actions/ai/findings";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel, Table } from "@/components/ui/Presentation";

export type Finding = Awaited<ReturnType<typeof getAiFindings>>[number];
type Decision = "FIXED" | "EXCEPTION_ACCEPTED" | "FALSE_POSITIVE" | "NEEDS_MORE";
const kinds: Record<string, { label: string; tone: "danger" | "warning" | "info" }> = {
  RULE_ERROR: { label: "Lỗi quy tắc chắc chắn", tone: "danger" },
  AI_SUSPICION: { label: "Nghi vấn AI", tone: "warning" },
  MISSING_DATA: { label: "Thiếu/không đọc được dữ liệu", tone: "info" },
};
const decisions: { code: Decision; label: string }[] = [
  { code: "FIXED", label: "Đã sửa" }, { code: "EXCEPTION_ACCEPTED", label: "Chấp nhận ngoại lệ" },
  { code: "FALSE_POSITIVE", label: "Không đúng cảnh báo" }, { code: "NEEDS_MORE", label: "Cần bổ sung" },
];
const routeLabel: Record<string, string> = { ACCOUNTANT: "Kế toán", ACCOUNT_OWNER: "Account/Project Owner", ADMIN: "Admin" };
const stateLabel = (status: string) => status === "OPEN" ? "Đang mở" :
  decisions.find((item) => item.code === status)?.label ?? status;

function locator(finding: Finding) {
  const span = finding.sourceSpan;
  if (!span) return `${finding.targetKind} ${finding.targetId}`;
  if (span.sheetName) return `${span.sheetName} · ${span.cellRange ?? "—"}`;
  if (span.pageNumber) return `trang ${span.pageNumber}`;
  if (span.xmlPath) return `XML ${span.xmlPath}`;
  return `đoạn ${span.textStart ?? "—"}–${span.textEnd ?? "—"}`;
}

export function AiInlineFindings({ findings, projectId }: { findings: Finding[]; projectId: string }) {
  const open = findings.filter((finding) => finding.status === "OPEN");
  if (open.length === 0) return null;
  return <div className="space-y-2" aria-label="Cảnh báo tại trường">
    {open.map((finding) => <Alert key={finding.id} tone={kinds[finding.kind]?.tone ?? "info"}
      title={kinds[finding.kind]?.label ?? finding.kind}>
      <p>{finding.ruleCode ?? "Cần rà soát"} · {locator(finding)}</p>
      {finding.sourceSpan && <a className="underline" target="_blank" rel="noopener noreferrer"
        href={`/api/projects/${projectId}/ai/runs/${finding.runId}/source/${finding.sourceSpan.sourceRevisionId}${finding.sourceSpan.pageNumber ? `#page=${finding.sourceSpan.pageNumber}` : ""}`}>
        Mở vị trí cần xử lý</a>}
    </Alert>)}
  </div>;
}

export default function AiFindingQueue({ projectId, inlineRunId, inlineFieldId, onOpenRun, onAccessRevoked }: {
  projectId: string; inlineRunId?: string; inlineFieldId?: string;
  onOpenRun?: (runId: string) => void; onAccessRevoked: () => void;
}) {
  const [rows, setRows] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("");
  const [state, setState] = useState("OPEN");
  const [owner, setOwner] = useState("");
  const [source, setSource] = useState("");
  const [date, setDate] = useState("");
  const [active, setActive] = useState<Finding | null>(null);
  const [decision, setDecision] = useState<Decision>("FIXED");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const reload = useCallback(async () => {
    try { const data = await getAiFindings({ projectId }); setRows(data); setError(""); }
    catch (cause) {
      setRows([]);
      if (cause instanceof Error && /not found|unauthor/i.test(cause.message)) { onAccessRevoked(); return; }
      setError("Không thể tải hàng chờ. Thử tải lại trang.");
    } finally { setLoading(false); }
  }, [projectId, onAccessRevoked]);
  useEffect(() => { void Promise.resolve().then(reload); }, [reload]);
  const scoped = rows.filter((item) => !inlineRunId || item.runId === inlineRunId)
    .filter((item) => !inlineFieldId || item.targetKind === "FIELD" && item.targetId === inlineFieldId);
  const filtered = scoped.filter((item) => (!kind || item.kind === kind) && (!state || item.status === state) &&
    (!owner || item.ownerId?.includes(owner)) && (!source || item.sourceKind === source) &&
    (!date || new Date(item.createdAt).toISOString().slice(0, 10) === date));
  function open(finding: Finding, trigger: HTMLButtonElement) {
    triggerRef.current = trigger; setActive(finding); setDecision("FIXED"); setReason(""); setError("");
  }
  function close() { setActive(null); setError(""); queueMicrotask(() => triggerRef.current?.focus()); }
  async function resolve() {
    if (!active || saving) return;
    if (reason.trim().length < 3) { setError("Nhập lý do ít nhất 3 ký tự."); reasonRef.current?.focus(); return; }
    setSaving(true); setError("");
    try { await resolveAiFinding({ projectId, findingId: active.id, decision, reason }); close(); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể lưu kết quả xử lý."); }
    finally { setSaving(false); }
  }
  function view(finding: Finding) {
    if (finding.sourceSpan) {
      const suffix = finding.sourceSpan.pageNumber ? `#page=${finding.sourceSpan.pageNumber}` : "";
      window.open(`/api/projects/${projectId}/ai/runs/${finding.runId}/source/${finding.sourceSpan.sourceRevisionId}${suffix}`, "_blank", "noopener,noreferrer");
    } else onOpenRun?.(finding.runId);
  }
  const card = (finding: Finding) => <Panel key={finding.id} className="min-w-0 space-y-2">
    <div className="flex flex-wrap gap-2"><Badge tone={kinds[finding.kind]?.tone ?? "info"}>{kinds[finding.kind]?.label ?? finding.kind}</Badge>
      <Badge>{stateLabel(finding.status)}</Badge></div>
    <h3 className="font-semibold">{finding.ruleCode ?? "Cần rà soát"}</h3>
    <p className="break-words text-sm">{finding.sourceName} · v{finding.sourceVersion} · {locator(finding)}</p>
    <p className="tf-ui-help">Run {finding.runId.slice(0, 10)} · {finding.ruleVersion ?? "—"} · Người phụ trách {finding.ownerId ?? "Chưa xác định"} · {routeLabel[finding.route] ?? finding.route}</p>
    <p className="tf-ui-help">Tạo {new Date(finding.createdAt).toLocaleString("vi-VN")}</p>
    {finding.resolvedAt && <p className="tf-ui-help">{stateLabel(finding.status)} · {finding.resolutionReason} · {finding.resolvedById} · {new Date(finding.resolvedAt).toLocaleString("vi-VN")}</p>}
    <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={() => view(finding)}>Mở vị trí cần xử lý</Button>
      {finding.status === "OPEN" && finding.canResolve && <Button variant="secondary" size="sm" onClick={(event) => open(finding, event.currentTarget)}>Ghi kết quả xử lý</Button>}</div>
  </Panel>;
  if (loading) return <Panel><p role="status">Đang tải hàng chờ…</p></Panel>;
  return <section aria-label={inlineFieldId ? "Cảnh báo tại trường" : "Hàng chờ cảnh báo Project"} className="min-w-0 space-y-3">
    {!inlineFieldId && <><h2 className="tf-ui-heading">Hàng chờ cảnh báo Project</h2>
      <p className="tf-ui-help">{scoped.filter((item) => item.kind === "RULE_ERROR" && item.status === "OPEN").length} lỗi quy tắc · {scoped.filter((item) => item.kind === "AI_SUSPICION" && item.status === "OPEN").length} nghi vấn AI · {scoped.filter((item) => item.kind === "MISSING_DATA" && item.status === "OPEN").length} mục thiếu dữ liệu</p>
      <div className="flex flex-wrap gap-2">{["", "RULE_ERROR", "AI_SUSPICION", "MISSING_DATA"].map((value) => <Button key={value} variant="secondary" size="sm"
        aria-pressed={kind === value} onClick={() => setKind(value)}>{value ? kinds[value].label : "Tất cả loại"}</Button>)}</div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Trạng thái" value={state} onChange={(event) => setState(event.target.value)}><option value="OPEN">Đang mở</option><option value="">Tất cả</option><option value="FIXED">Đã sửa</option><option value="EXCEPTION_ACCEPTED">Chấp nhận ngoại lệ</option><option value="FALSE_POSITIVE">Không đúng cảnh báo</option><option value="NEEDS_MORE">Cần bổ sung</option></Select>
        <Input label="Người phụ trách" value={owner} onChange={(event) => setOwner(event.target.value)} />
        <Select label="Loại nguồn" value={source} onChange={(event) => setSource(event.target.value)}><option value="">Tất cả</option>{[...new Set(rows.map((item) => item.sourceKind))].map((value) => <option key={value} value={value}>{value}</option>)}</Select>
        <Input label="Ngày tạo" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </div></>}
    {error && <Alert tone="danger" title="Cần xử lý">{error}</Alert>}
    {filtered.length === 0 ? <EmptyState title="Không có mục khớp bộ lọc" description="Đổi bộ lọc hoặc chờ kết quả phân tích được tạo." /> : <>
      <div className="grid min-w-0 gap-3 md:hidden">{filtered.map(card)}</div>
      <div className="hidden md:block"><Table caption="Hàng chờ cảnh báo Project"><thead><tr><th scope="col">Loại</th><th scope="col">Nguồn/vị trí</th><th scope="col">Người/luồng</th><th scope="col">Trạng thái</th><th scope="col">Hành động</th></tr></thead>
        <tbody>{filtered.map((finding) => <tr key={finding.id}><th scope="row"><Badge tone={kinds[finding.kind]?.tone ?? "info"}>{kinds[finding.kind]?.label ?? finding.kind}</Badge><br />{finding.ruleCode}</th>
          <td>{finding.sourceName} · {locator(finding)}<br />Run {finding.runId.slice(0, 10)} · {finding.ruleVersion}</td>
          <td>{finding.ownerId ?? "—"} · {routeLabel[finding.route] ?? finding.route}</td><td>{stateLabel(finding.status)}</td>
          <td><Button variant="secondary" size="sm" onClick={() => view(finding)}>Mở vị trí cần xử lý</Button>{finding.status === "OPEN" && finding.canResolve && <Button variant="secondary" size="sm" onClick={(event) => open(finding, event.currentTarget)}>Ghi kết quả xử lý</Button>}</td></tr>)}</tbody></Table></div>
    </>}
    <Dialog open={!!active} onClose={close} title="Ghi kết quả xử lý cảnh báo" footer={<><Button variant="secondary" onClick={close}>Đóng</Button><Button variant="primary" loading={saving} loadingLabel="Đang lưu…" onClick={resolve}>Lưu kết quả</Button></>}>
      <Select label="Kết quả xử lý" value={decision} onChange={(event) => setDecision(event.target.value as Decision)}>
        {decisions.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
      </Select>
      <Textarea ref={reasonRef} label="Lý do xử lý" required value={reason} onChange={(event) => setReason(event.target.value)} error={error || undefined} />
      {decision === "EXCEPTION_ACCEPTED" && <Alert tone="warning" title="Giới hạn của ngoại lệ">Kết quả này chỉ đóng cảnh báo. Không cấp quyền duyệt, thanh toán hoặc bỏ qua quy trình.</Alert>}
    </Dialog>
  </section>;
}
