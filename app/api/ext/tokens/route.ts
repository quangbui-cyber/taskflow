import { getCurrentUser } from "@/lib/auth";
import { listUserExtensionTokens, revokeExtensionToken } from "@/lib/extensionAuth";
import { handleCorsPreflight, jsonWithCors } from "@/lib/extensionCors";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

/** Lấy danh sách token extension của người dùng đăng nhập */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return jsonWithCors({ error: "Phiên đăng nhập đã hết hạn." }, { status: 401 }, request);
  }

  const tokens = await listUserExtensionTokens(user.id);
  return jsonWithCors({ tokens }, { status: 200 }, request);
}

/** Thu hồi một token extension */
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return jsonWithCors({ error: "Phiên đăng nhập đã hết hạn." }, { status: 401 }, request);
  }

  let tokenId = "";
  try {
    const body = (await request.json()) as { id?: unknown };
    tokenId = typeof body.id === "string" ? body.id : "";
  } catch {
    const { searchParams } = new URL(request.url);
    tokenId = searchParams.get("id") ?? "";
  }

  if (!tokenId) {
    return jsonWithCors({ error: "Thiếu mã token cần thu hồi." }, { status: 400 }, request);
  }

  const revoked = await revokeExtensionToken(tokenId, user.id);
  if (!revoked) {
    return jsonWithCors({ error: "Không tìm thấy token hoặc đã bị thu hồi trước đó." }, { status: 404 }, request);
  }

  return jsonWithCors({ success: true }, { status: 200 }, request);
}
