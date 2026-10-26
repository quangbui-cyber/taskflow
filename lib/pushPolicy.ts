import { ECDH } from "node:crypto";

export type PushRegistration = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

// Never let a submitted endpoint turn the sender into a general HTTP proxy.
export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const url = new URL(value);
    const host = url.hostname;
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.port && !url.hash && url.pathname !== "/" &&
      (host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
        host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com"));
  } catch {
    return false;
  }
}

export function parsePushRegistration(value: unknown): PushRegistration | null {
  if (!value || typeof value !== "object") return null;
  const sub = value as Partial<PushRegistration>;
  if (!isPushEndpoint(sub.endpoint) || !sub.keys) return null;
  const { p256dh, auth } = sub.keys;
  if (typeof p256dh !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(p256dh) ||
      typeof auth !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(auth)) return null;
  try {
    const point = Buffer.from(p256dh, "base64url");
    if (point.length !== 65 || point[0] !== 4 || Buffer.from(auth, "base64url").length !== 16) return null;
    ECDH.convertKey(point, "prime256v1");
    return { endpoint: sub.endpoint, keys: { p256dh, auth } };
  } catch {
    return null;
  }
}

export function notificationDestination(data: { type?: string; projectId?: string; taskId?: string; recognitionId?: string; meetingId?: string }) {
  if (data.type?.startsWith("LEAVE_")) return "/leave";
  if (data.type?.startsWith("FINANCE_") && data.projectId) {
    return `/projects/${encodeURIComponent(data.projectId)}?tab=finance`;
  }
  if (data.recognitionId) return `/recognition?focus=${encodeURIComponent(data.recognitionId)}#recognition-${encodeURIComponent(data.recognitionId)}`;
  if (data.meetingId && data.type === "MEETING_RECAP_PROMPT") return `/meetings/${encodeURIComponent(data.meetingId)}/recap?record=1`;
  if (data.meetingId && data.type?.startsWith("MEETING_RECAP_")) return `/meetings/${encodeURIComponent(data.meetingId)}/recap`;
  if (data.meetingId) return `/meetings?focus=${encodeURIComponent(data.meetingId)}#meeting-${encodeURIComponent(data.meetingId)}`;
  if (data.projectId) return `/projects/${encodeURIComponent(data.projectId)}${data.taskId ? `?task=${encodeURIComponent(data.taskId)}` : ""}`;
  return "/notifications";
}
