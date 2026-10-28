"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, EmptyState, Panel } from "@/components/ui/Presentation";
import { Button } from "@/components/ui/Button";
import type { AnswerSource, CitedAnswer } from "@/lib/ai/qa/answer";
import { normalizeAssistantResponse } from "@/lib/ai/qa/answerView";

type Scope = { kind: "project"; projectId: string; projectName: string } | { kind: "global" };
type OpenCitation = { quote: string; originKind: string; originId: string; originVersion: string;
  locator: { pageNumber: number | null; sheetName: string | null; cellRange: string | null;
    xmlPath: string | null; textStart: number | null; textEnd: number | null } };

function locator(source: AnswerSource) {
  return [source.pageNumber && `trang ${source.pageNumber}`, source.sheetName,
    source.cellRange, source.xmlPath, source.textStart !== null && `vị trí ${source.textStart}`]
    .filter(Boolean).join(", ") || "đoạn trích";
}

export default function AiAssistantWorkspace({ scope }: { scope: Scope }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<CitedAnswer | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [citation, setCitation] = useState<OpenCitation | null>(null);
  const [revoked, setRevoked] = useState(false);
  const composing = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const citationTrigger = useRef<HTMLButtonElement | null>(null);
  const closeCitation = useRef<HTMLButtonElement | null>(null);
  const sourceById = new Map(answer?.sources.map((source) => [source.spanId, source]) ?? []);

  useEffect(() => { if (citation) closeCitation.current?.focus(); }, [citation]);

  function dismissCitation() { setCitation(null); citationTrigger.current?.focus(); }

  async function submit() {
    const value = question.trim();
    if (!value || pending || composing.current) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPending(true); setMessage(""); setAnswer(null); setCitation(null);
    try {
      const path = scope.kind === "project" ? `/api/projects/${encodeURIComponent(scope.projectId)}/ai/assistant` : "/api/ai/assistant";
      const response = await fetch(path, { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: value }),
        signal: controller.signal });
      if ([401, 403, 404].includes(response.status)) { setRevoked(true); return; }
      if (!response.ok) { setMessage("Không thể tải câu trả lời. Vui lòng thử lại."); return; }
      const next = normalizeAssistantResponse(await response.json());
      if (!next) { setMessage("Câu trả lời chưa có dẫn nguồn hợp lệ. Vui lòng thử lại."); return; }
      setAnswer(next);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setMessage("Không thể tải câu trả lời. Vui lòng thử lại.");
    } finally { setPending(false); }
  }

  async function openSource(source: AnswerSource) {
    citationTrigger.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    setCitation(null); setMessage("");
    try {
      const response = await fetch(`/api/ai/citations/${encodeURIComponent(source.spanId)}`, { cache: "no-store" });
      if ([401, 403, 404].includes(response.status)) {
        setAnswer(null); setRevoked(true); return;
      }
      if (!response.ok) { setMessage("Không thể mở nguồn lúc này."); return; }
      setCitation(await response.json() as OpenCitation);
    } catch { setMessage("Không thể mở nguồn lúc này."); }
  }

  if (revoked) return <Alert tone="warning" title="Bạn không còn quyền mở nguồn này">
    <p>Không thể trả lời trong phạm vi quyền hiện tại.</p>
  </Alert>;
  return <section aria-label="Trợ lý có dẫn nguồn" className="min-w-0 space-y-4">
    <Alert title={scope.kind === "project" ? `Phạm vi: Project ${scope.projectName}` : "Phạm vi: Tra cứu nội bộ"}>
      <p>{scope.kind === "project" ? "Chỉ dùng hồ sơ/phiên bản bạn được quyền xem trong Project này." :
        "Chỉ dùng SOP/chính sách đã công bố và hồ sơ bạn được quyền xem."}</p>
    </Alert>
    <Panel className="min-w-0 space-y-3">
      <label htmlFor={`ai-question-${scope.kind}`} className="block font-semibold">Câu hỏi về hồ sơ hoặc quy trình</label>
      <textarea id={`ai-question-${scope.kind}`} value={question} maxLength={500} rows={3}
        onChange={(event) => setQuestion(event.target.value)} onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current) {
          event.preventDefault(); void submit();
        } }} className="tf-input w-full min-w-0" />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void submit()} disabled={!question.trim() || pending}>Tìm câu trả lời có dẫn nguồn</Button>
        {pending && <Button variant="secondary" onClick={() => abort.current?.abort()}>Hủy</Button>}
      </div>
      {pending && <p role="status">Đang tìm trong các nguồn được phép…</p>}
    </Panel>
    {message && <Alert tone="warning" title={message} />}
    {answer?.status === "OK" && <Panel className="min-w-0 space-y-3">
      <h2 className="tf-ui-heading">Câu trả lời có dẫn nguồn</h2>
      {answer.claims.map((claim, index) => <p key={`${index}-${claim.text}`} className="break-words">
        {claim.text}{" "}{claim.citationSpanIds.map((id) => {
          const source = sourceById.get(id);
          return source && <Button key={id} size="sm" variant="secondary" className="ml-1"
            aria-label={`Mở nguồn ${index + 1}: ${source.filename}, phiên bản ${source.originVersion}, ${locator(source)}`}
            onClick={() => void openSource(source)}>[{index + 1}]</Button>;
        })}
      </p>)}
      <h3 className="font-semibold">Nguồn đã dùng</h3>
      <ul className="space-y-2">{answer.sources.map((source) => <li key={source.spanId} className="break-all">
        <Button variant="secondary" size="sm" onClick={() => void openSource(source)}
          aria-label={`Mở nguồn: ${source.filename}, phiên bản ${source.originVersion}, ${locator(source)}`}>
          {source.filename} · {source.originVersion} · {locator(source)} · {source.historical ? "lịch sử" : "hiện hành"}
        </Button>
      </li>)}</ul>
    </Panel>}
    {answer?.status === "CONFLICT" && <Alert tone="warning" title="Nguồn đang mâu thuẫn">
      <p>Các nguồn dưới đây đưa ra thông tin khác nhau. AI không tự chọn kết luận. Vui lòng chuyển cho {answer.confirmingRole} xác nhận.</p>
      <ul>{answer.conflicts.map((source) => <li key={source.spanId}>{source.filename} · {source.originVersion} · {locator(source)}</li>)}</ul>
    </Alert>}
    {answer?.status === "INSUFFICIENT" && <Alert tone="warning" title="Chưa đủ căn cứ để trả lời">
      <p>Không tìm thấy nguồn đã công bố hoặc hồ sơ có phiên bản đủ để kết luận. Hãy bổ sung nguồn hoặc hỏi {answer.confirmingRole}.</p>
    </Alert>}
    {answer?.status === "REFUSED" && <Alert tone="warning" title="Không thể trả lời trong phạm vi quyền hiện tại." />}
    {answer?.status === "INCOMPLETE" && <Alert tone="warning" title="Câu trả lời chưa hoàn tất">
      <p>{answer.missingEvidence || "Vui lòng thử lại."}</p>
    </Alert>}
    {!answer && !pending && !message && <EmptyState title="Chưa có câu hỏi trong phiên này" />}
    {citation && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-label="Nguồn dẫn"
        className="tf-panel max-h-[85vh] w-full max-w-2xl space-y-2 overflow-auto"
        onKeyDown={(event) => { if (event.key === "Escape") dismissCitation();
          if (event.key === "Tab") event.preventDefault(); }}>
        <h2 className="font-semibold">Nguồn dẫn · {citation.originKind} · {citation.originVersion}</h2>
        <p className="whitespace-pre-wrap break-words">{citation.quote}</p>
        <Button ref={closeCitation} variant="secondary" onClick={dismissCitation}>Đóng nguồn</Button>
      </div>
    </div>}
    <p className="tf-ui-help">Lịch sử trao đổi — không phải nguồn authoritative</p>
  </section>;
}
