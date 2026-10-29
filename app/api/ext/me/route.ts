import { verifyExtensionToken } from "@/lib/extensionAuth";
import { handleCorsPreflight, jsonWithCors } from "@/lib/extensionCors";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

export async function GET(request: Request) {
  const user = await verifyExtensionToken(request.headers.get("authorization"));
  if (!user) {
    return jsonWithCors({ error: "Token không hợp lệ hoặc đã bị thu hồi." }, { status: 401 }, request);
  }

  return jsonWithCors(
    {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
    },
    { status: 200 },
    request
  );
}
