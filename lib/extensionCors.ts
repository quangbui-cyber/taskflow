/**
 * Xử lý CORS cho các API endpoint của Chrome Extension (/api/ext/*).
 * Cho phép request từ chrome-extension:// và tên miền của myCreative.
 */

export function extensionCorsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get("origin") ?? "*";
  const isAllowedOrigin =
    origin.startsWith("chrome-extension://") ||
    origin.includes("localhost") ||
    origin.includes("vercel.app") ||
    origin.includes("creativestation.vn");

  return {
    "Access-Control-Allow-Origin": isAllowedOrigin ? origin : "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Requested-With",
    "Access-Control-Max-Age": "86400",
  };
}

export function handleCorsPreflight(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: extensionCorsHeaders(request),
  });
}

export function jsonWithCors(data: unknown, init?: ResponseInit, request?: Request): Response {
  const headers = new Headers(init?.headers);
  const cors = extensionCorsHeaders(request);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }
  return Response.json(data, { ...init, headers });
}
