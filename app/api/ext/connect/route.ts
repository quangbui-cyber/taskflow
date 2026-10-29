import { getCurrentUser } from "@/lib/auth";
import { createExtensionToken } from "@/lib/extensionAuth";
import { handleCorsPreflight, jsonWithCors } from "@/lib/extensionCors";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

/** Tạo token mới cho Chrome Extension (người dùng đã đăng nhập web) */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return jsonWithCors({ error: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." }, { status: 401 }, request);
  }

  let label: string | undefined;
  try {
    const body = (await request.json()) as { label?: unknown };
    label = typeof body.label === "string" ? body.label : undefined;
  } catch {
    label = undefined;
  }

  const result = await createExtensionToken({
    userId: user.id,
    label: label ?? "Chrome Extension",
  });

  return jsonWithCors(
    {
      success: true,
      token: result.token,
      label: result.label,
      id: result.id,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    },
    { status: 201 },
    request
  );
}
