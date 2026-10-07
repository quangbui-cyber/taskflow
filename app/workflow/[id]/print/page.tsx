import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadDocument } from "@/lib/workflow/service";
import type { DocumentPayload } from "@/lib/workflow/documents";
import PrintCostFlow from "@/components/PrintCostFlow";

export default async function WorkflowPrint({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(); const { id } = await params;
  const detail = await loadDocument(id, user); if (!detail) notFound();
  const r = detail.request; const body = r.payload as unknown as DocumentPayload;
  return <main className="mx-auto max-w-4xl space-y-5 p-6"><PrintCostFlow /><p className="text-sm">CREATIVE STATION · Trang thông tin hồ sơ</p><h1 className="text-2xl font-semibold">{r.title}</h1><p>{r.project?.name ?? "Nội bộ độc lập"}</p><p className="text-sm">Mã {r.id} · Mẫu {body.templateSnapshot?.name ?? r.template?.name} v{body.templateSnapshot?.version ?? r.template?.version}</p><p>{r.state === "APPROVED" ? "Đã duyệt" : "Chưa duyệt xong"} · {body.signature?.state === "CONFIRMED" ? "Đã xác nhận đủ bản ký" : "Chưa xác nhận đủ bản ký"}</p><p className="whitespace-pre-wrap">{body.content}</p>{body.counterparty && <p>Đối tác: {body.counterparty}</p>}{body.amount && <p>Giá trị: {body.amount} VND</p>}<p>Người/bên ký theo mẫu: {body.templateSnapshot?.signerNames ?? "Chưa cấu hình"}</p><p className="text-sm">Tài liệu chính do công ty soạn được lưu riêng theo mã file {body.mainFileId || "Chưa lưu"}. Trang này không thay nội dung tài liệu hoặc bằng chứng ký.</p></main>;
}
