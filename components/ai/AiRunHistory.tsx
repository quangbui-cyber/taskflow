"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel } from "@/components/ui/Presentation";

export type AiRunView = {
  id: string; task: string; status: string; reviewStatus: string; actorId: string;
  parserVersion: string; pipelineVersion: string; configVersion: string; model: string;
  createdAt: string; completedAt: string | null;
  failureCode: string | null; sources: { role: string; filename: string; version: string; sha256: string }[];
};
const statusLabel: Record<string, string> = {
  READY: "Mới", RUNNING: "Đang chạy", SUCCEEDED: "Đã tạo kết quả",
  FAILED: "Thất bại", INCOMPLETE: "Chưa hoàn tất", CANCELLED: "Đã hủy",
};

export default function AiRunHistory({ projectId, revision, onSelect, onAccessRevoked }: {
  projectId: string; revision: number; onSelect: (run: AiRunView) => void; onAccessRevoked: () => void;
}) {
  const [runs, setRuns] = useState<AiRunView[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [taskFilter, setTaskFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/ai/runs`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 403 || response.status === 404 || response.status === 401) { onAccessRevoked(); return null; }
        if (!response.ok) throw new Error("Không thể tải lịch sử AI.");
        return response.json() as Promise<{ runs: AiRunView[] }>;
      })
      .then((data) => { if (!cancelled && data) { setRuns(data.runs); setError(""); } })
      .catch(() => { if (!cancelled) setError("Không thể tải lịch sử AI. Thử tải lại trang."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, revision, onAccessRevoked]);
  if (loading) return <Panel><p role="status">Đang tải lịch sử…</p></Panel>;
  const shown = runs.filter((run) => (!taskFilter || run.task === taskFilter) &&
    (!reviewFilter || run.reviewStatus === reviewFilter) &&
    (!sourceFilter || run.sources.some((source) => source.filename.toLocaleLowerCase("vi-VN").includes(sourceFilter.toLocaleLowerCase("vi-VN")))) &&
    (!actorFilter || run.actorId.includes(actorFilter)) &&
    (!dateFilter || run.createdAt.slice(0, 10) === dateFilter));
  return <section aria-label="Lịch sử phân tích" className="space-y-3">
    <h2 className="tf-ui-heading">Lịch sử phân tích</h2>
    {runs.length > 0 && <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <Select label="Loại run" value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}>
        <option value="">Tất cả</option>{[...new Set(runs.map((run) => run.task))].map((task) => <option key={task} value={task}>{task}</option>)}
      </Select>
      <Select label="Rà soát" value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)}>
        <option value="">Tất cả</option><option value="PENDING">Chưa rà soát</option><option value="COMPLETED">Đã rà soát</option>
      </Select>
      <Input label="Nguồn" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} />
      <Input label="Người tạo" value={actorFilter} onChange={(event) => setActorFilter(event.target.value)} />
      <Input label="Ngày tạo" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} />
    </div>}
    {error && <Alert tone="danger" title="Không thể tải lịch sử">{error}</Alert>}
    {!error && runs.length === 0 && <EmptyState title="Chưa có run AI" description="Chọn nguồn rồi bấm Phân tích bằng AI để tạo run đầu tiên." />}
    {!error && runs.length > 0 && shown.length === 0 && <EmptyState title="Không có run khớp bộ lọc" description="Đổi bộ lọc để xem run khác." />}
    <div className="grid min-w-0 gap-3 md:grid-cols-2">{shown.map((run) => <Panel key={run.id} className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">Run {run.id.slice(0, 10)}</h3>
        <Badge tone={run.status === "FAILED" ? "danger" : run.status === "SUCCEEDED" ? "success" : "info"}>{statusLabel[run.status] ?? run.status}</Badge>
        <Badge>Chỉ đọc</Badge></div>
      <p className="tf-ui-help">{run.task === "DOCUMENT_EXTRACTION" ? "Trích xuất chứng từ" : run.task} · {new Date(run.createdAt).toLocaleString("vi-VN")}</p>
      <p className="tf-ui-help">Người tạo: {run.actorId} · Rà soát: {run.reviewStatus === "COMPLETED" ? "Đã rà soát" : "Chưa rà soát"}</p>
      <ul className="space-y-1">{run.sources.map((source, index) => <li key={`${source.sha256}-${index}`} className="break-words text-sm">
        {source.filename} · v{source.version} · {source.role} · SHA-256 {source.sha256.slice(0, 12)}
      </li>)}</ul>
      <details className="text-sm"><summary>Phiên bản xử lý</summary>
        <p>Parser {run.parserVersion} · Pipeline {run.pipelineVersion} · Model {run.model} · Config {run.configVersion.slice(0, 12)}</p>
      </details>
      {run.failureCode && <p className="tf-ui-help">Kết quả: {run.failureCode}</p>}
      <Button variant="secondary" size="sm" onClick={() => onSelect(run)}>Xem kết quả đã có</Button>
    </Panel>)}</div>
  </section>;
}
