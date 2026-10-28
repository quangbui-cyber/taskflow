"use client";

import { useRef, useState } from "react";
import { executeAiDocumentRun } from "@/app/actions/ai/review";
import { Button } from "@/components/ui/Button";
import { Alert, EmptyState, Panel } from "@/components/ui/Presentation";
import type { AiSourceOption } from "./ProjectAiWorkspace";
import type { AiRunView } from "./AiRunHistory";

function validPair(sources: AiSourceOption[]) {
  if (sources.length === 1) return true;
  if (sources.length !== 2 || sources.some((source) => !source.id.startsWith("VENDOR_INVOICE_FILE:"))) return false;
  const roles = sources.map((source) => source.mimeType === "application/pdf" ? "PDF" :
    ["application/xml", "text/xml"].includes(source.mimeType) ? "XML" : "INVALID");
  return roles.includes("XML") && roles.includes("PDF") && !!sources[0].businessKey && sources[0].businessKey === sources[1].businessKey;
}

export default function AiRunLauncher({ projectId, projectName, sources, providerEnabled, onRun, onAccessRevoked }: {
  projectId: string; projectName: string; sources: AiSourceOption[]; providerEnabled: boolean;
  onRun: (run: AiRunView) => void; onAccessRevoked: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestId = useRef(0);
  const chosen = selected.map((id) => sources.find((source) => source.id === id)).filter((source): source is AiSourceOption => !!source);
  const ready = validPair(chosen) && chosen.length > 0;
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-2));
  async function launch() {
    if (!ready || !providerEnabled || pending) return;
    const current = ++requestId.current;
    setPending(true); setError(""); setMessage("Đang phân tích chứng từ…");
    try {
      const pairRoles = chosen.length === 2 ? Object.fromEntries(chosen.map((source) => [source.id,
        source.mimeType === "application/pdf" ? "PDF" : "XML"])) : undefined;
      const response = await fetch(`/api/projects/${projectId}/ai/runs`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "ANALYZE", task: "DOCUMENT_EXTRACTION", sourceIds: selected, pairRoles }),
      });
      if ([401, 403, 404].includes(response.status)) { onAccessRevoked(); return; }
      if (!response.ok) throw new Error(response.status === 503 ? "AI trực tuyến chưa được bật cho môi trường này." : "Không thể tạo run. Kiểm tra nguồn đã chọn rồi thử lại.");
      const created = await response.json() as { id: string; reused: boolean; status: string };
      if (created.status === "READY") await executeAiDocumentRun({ projectId, runId: created.id });
      const detail = await fetch(`/api/projects/${projectId}/ai/runs/${created.id}`, { cache: "no-store" });
      if ([401, 403, 404].includes(detail.status)) { onAccessRevoked(); return; }
      if (!detail.ok) throw new Error("Run đã tạo nhưng chưa tải được kết quả. Mở Lịch sử để xem lại.");
      const run = await detail.json() as AiRunView;
      if (current === requestId.current) { setMessage(created.reused ? "Đang mở kết quả đã có." : "Đã tạo kết quả phân tích."); onRun(run); }
    } catch (cause) {
      if (current === requestId.current) { setError(cause instanceof Error ? cause.message : "Không thể phân tích. Thử lại hoặc tiếp tục thủ công."); setMessage(""); }
    } finally { if (current === requestId.current) setPending(false); }
  }
  return <Panel className="min-w-0 space-y-4">
    <div><h2 className="tf-ui-heading">Nguồn sẽ phân tích</h2><p className="tf-ui-help">Project: {projectName}. Chọn một chứng từ hoặc một bộ XML/PDF cùng hóa đơn.</p></div>
    {sources.length === 0 ? <EmptyState title="Chưa có nguồn phù hợp" description="Tải PDF, XML hoặc TXT vào Tài liệu của Project. Với Excel, dùng bộ đọc chuẩn trong CostFlow." /> :
      <div className="grid min-w-0 gap-2 md:grid-cols-2">{sources.map((source) => <label key={source.id} className="tf-panel min-w-0 cursor-pointer p-3">
        <span className="flex items-start gap-2"><input type="checkbox" checked={selected.includes(source.id)} onChange={() => toggle(source.id)}
          aria-label={`Chọn ${source.name}`} className="mt-1" /><span className="min-w-0 break-words"><strong>{source.name}</strong><br />
          <span className="tf-ui-help">{source.kind} · phiên bản {source.version} · {new Date(source.createdAt).toLocaleString("vi-VN")}
            {source.hashPrefix && ` · SHA-256 ${source.hashPrefix}`}</span></span></span>
      </label>)}</div>}
    <p aria-live="polite" className="tf-ui-help">Phạm vi đã chọn: {chosen.length === 1 ? "1 chứng từ" : chosen.length === 2 ? "2 file trong bộ đã chọn" : "chưa chọn nguồn"}.</p>
    {chosen.length > 0 && !ready && <Alert tone="warning" title="Bộ nguồn chưa hợp lệ">Chỉ chọn một chứng từ, hoặc một XML và một PDF cùng hóa đơn.</Alert>}
    <Alert title="Phạm vi gửi đến AI">Chỉ dữ liệu cần thiết trong phạm vi đã chọn được gửi để phân tích. Tệp gốc và các vùng ngoài phạm vi không được gửi. Dữ liệu nhạy cảm được che trước khi gửi.</Alert>
    {!providerEnabled && <Alert tone="warning" title="AI chưa khả dụng">AI trực tuyến chưa được bật cho môi trường này. Bạn vẫn có thể dùng bộ đọc chuẩn hoặc nhập thủ công.</Alert>}
    {error && <Alert tone="danger" title="Không thể phân tích">{error}</Alert>}
    {message && <p role="status">{message}</p>}
    <Button variant="primary" loading={pending} loadingLabel="Đang phân tích chứng từ…" disabled={!ready || !providerEnabled}
      onClick={launch}>Phân tích bằng AI</Button>
  </Panel>;
}
