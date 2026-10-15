import { costFlowAction } from "@/app/actions/costflow";

const MAX_PAIRED_BODY = Math.floor(4.2 * 1024 * 1024);

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return Response.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  const { id: projectId } = await params;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PAIRED_BODY) return Response.json({ error: "Dữ liệu paired vượt quá 4,2 MiB." }, { status: 413 });
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_PAIRED_BODY) return Response.json({ error: "Dữ liệu paired vượt quá 4,2 MiB." }, { status: 413 });
  const contentType = request.headers.get("content-type");
  if (!contentType) return Response.json({ error: "Thiếu định dạng dữ liệu paired." }, { status: 422 });
  const form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  const submittedProjectId = String(form.get("projectId") ?? "").trim();
  if (submittedProjectId && submittedProjectId !== projectId) return Response.json({ error: "Project không hợp lệ." }, { status: 400 });
  form.set("projectId", projectId);
  const result = await costFlowAction({}, form);
  return Response.json(result, {
    status: result.error ? 422 : 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
