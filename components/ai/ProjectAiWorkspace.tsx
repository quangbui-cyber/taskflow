"use client";

import { useCallback, useState } from "react";
import { Alert, EmptyState, Panel } from "@/components/ui/Presentation";
import { Button } from "@/components/ui/Button";
import AiRunLauncher from "./AiRunLauncher";
import AiRunHistory, { type AiRunView } from "./AiRunHistory";
import AiReviewWorkspace from "./AiReviewWorkspace";

export type AiSourceOption = {
  id: string; name: string; kind: string; mimeType: string; version: string;
  hashPrefix: string | null; businessKey: string | null; createdAt: string;
};
type WorkspaceTab = "analysis" | "review" | "findings" | "assistant" | "history";

export default function ProjectAiWorkspace({ projectId, projectName, sources, providerEnabled }: {
  projectId: string; projectName: string; sources: AiSourceOption[]; providerEnabled: boolean;
}) {
  const [tab, setTab] = useState<WorkspaceTab>("analysis");
  const [selectedRun, setSelectedRun] = useState<AiRunView | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [accessRevoked, setAccessRevoked] = useState(false);
  const openRun = (run: AiRunView) => { setSelectedRun(run); setTab("review"); };
  const revoke = useCallback(() => { setAccessRevoked(true); setSelectedRun(null); }, []);
  if (accessRevoked) return <Alert tone="warning" title="Không còn quyền xem nội dung AI">
    <p>Nội dung đã được ẩn. Quay lại Project và tải lại quyền truy cập.</p>
  </Alert>;
  return <section aria-label="Không gian AI dự án" className="mt-6 min-w-0 space-y-4">
    <Alert title="AI hỗ trợ rà soát dữ liệu"><p>AI chỉ hỗ trợ trích xuất, đối chiếu và dẫn nguồn. Kết quả này không phải phê duyệt, xác nhận thuế, quyền chi tiền, chữ ký hoặc đóng tài chính.</p></Alert>
    <nav aria-label="Mục AI" className="flex max-w-full flex-wrap gap-2">
      {([ ["analysis", "Phân tích"], ["review", "Rà soát"], ["findings", "Cảnh báo"], ["assistant", "Trợ lý"], ["history", "Lịch sử"] ] as const).map(([key, label]) =>
        <Button key={key} variant={tab === key ? "primary" : "secondary"} size="sm"
          aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>{label}</Button>)}
    </nav>
    {tab === "analysis" && <AiRunLauncher projectId={projectId} projectName={projectName} sources={sources}
      providerEnabled={providerEnabled} onRun={(run) => { setHistoryRevision((value) => value + 1); openRun(run); }} onAccessRevoked={revoke} />}
    {tab === "review" && (selectedRun
      ? <AiReviewWorkspace projectId={projectId} run={selectedRun} onAccessRevoked={revoke}
          onHistoryChange={() => setHistoryRevision((value) => value + 1)} />
      : <EmptyState title="Chưa chọn kết quả để rà soát" description="Chọn một run trong Lịch sử hoặc bắt đầu phân tích một nguồn." />)}
    {tab === "history" && <AiRunHistory projectId={projectId} revision={historyRevision} onSelect={openRun} onAccessRevoked={revoke} />}
    {tab === "findings" && <Panel><h2 className="tf-ui-heading">Cảnh báo</h2><p className="tf-ui-help">Chưa có cảnh báo từ nguồn đã chọn.</p></Panel>}
    {tab === "assistant" && <Panel><h2 className="tf-ui-heading">Trợ lý tri thức</h2><p className="tf-ui-help">Chưa có câu hỏi trong phiên này.</p></Panel>}
  </section>;
}
