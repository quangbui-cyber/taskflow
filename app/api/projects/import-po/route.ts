import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { canManageProjects, getCurrentUser } from "@/lib/auth";
import { MAX_PROJECT_FILE_SIZE } from "@/lib/projectFiles";
import { parsePurchaseOrder } from "@/lib/purchaseOrder";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { error: "Phiên đăng nhập đã hết hạn." },
      { status: 401 }
    );
  }
  if (!canManageProjects(user.role)) {
    return Response.json(
      { error: "Bạn không có quyền tạo dự án từ PO." },
      { status: 403 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Vui lòng chọn file PDF." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_PROJECT_FILE_SIZE) {
    return Response.json(
      { error: "File PDF phải nhỏ hơn 4 MB." },
      { status: 400 }
    );
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder("ascii").decode(data.slice(0, 5));
  if (!header.startsWith("%PDF-")) {
    return Response.json(
      { error: "File được chọn không phải PDF hợp lệ." },
      { status: 400 }
    );
  }

  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText({ first: 5 });
    const draft = parsePurchaseOrder(result.text);
    return Response.json({ draft, fileName: file.name });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Không thể đọc nội dung PO này.";
    return Response.json({ error: message }, { status: 422 });
  } finally {
    await parser.destroy();
  }
}
