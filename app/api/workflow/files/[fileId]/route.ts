import { getCurrentUser } from "@/lib/auth";
import { downloadWorkflowFile } from "@/lib/workflow/service";

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Không tìm thấy", { status: 404 });
  const { fileId } = await params; const file = await downloadWorkflowFile(fileId, user);
  if (!file) return new Response("Không tìm thấy", { status: 404 });
  return new Response(new Uint8Array(file.data), { headers: { "Content-Type": file.mimeType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, "Content-Length": String(file.size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
