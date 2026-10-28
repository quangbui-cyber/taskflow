/**
 * myCreative Recorder - API Client
 */

export const DEFAULT_BASE_URL = "https://mycreative.vercel.app";

export async function getConfig() {
  // 1. Nếu có chrome.storage (popup, background, options)
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const data = await chrome.storage.local.get(["mycreative_token", "mycreative_base_url"]);
    return {
      token: data.mycreative_token || "",
      baseUrl: data.mycreative_base_url || DEFAULT_BASE_URL,
    };
  }

  // 2. Nếu ở trong offscreen document (không có chrome.storage) -> hỏi background script
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_CONFIG" }, (res) => {
        resolve({
          token: res?.token || "",
          baseUrl: res?.baseUrl || DEFAULT_BASE_URL,
        });
      });
    });
  }

  return {
    token: "",
    baseUrl: DEFAULT_BASE_URL,
  };
}

export async function setConfig({ token, baseUrl }) {
  const payload = {};
  if (token !== undefined) payload.mycreative_token = token.trim();
  if (baseUrl !== undefined) payload.mycreative_base_url = baseUrl.trim().replace(/\/+$/, "");
  await chrome.storage.local.set(payload);
}

export async function clearToken() {
  await chrome.storage.local.remove(["mycreative_token", "mycreative_user"]);
}

async function apiRequest(path, options = {}) {
  const { token, baseUrl } = await getConfig();
  if (!token && !options.noAuth) {
    throw new Error("Chưa kết nối tài khoản myCreative.");
  }

  const url = `${baseUrl}${path}`;
  const headers = {
    Accept: "application/json",
    ...options.headers,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type") || "";
  let data = null;
  if (contentType.includes("application/json")) {
    data = await response.json().catch(() => null);
  } else {
    data = await response.text().catch(() => null);
  }

  if (!response.ok) {
    const errorMsg = data?.error || (typeof data === "string" ? data : `Lỗi ${response.status}`);
    throw new Error(errorMsg);
  }

  return data;
}

export async function checkAuth() {
  const res = await apiRequest("/api/ext/me");
  if (res?.user) {
    await chrome.storage.local.set({ mycreative_user: res.user });
  }
  return res?.user;
}

export async function lookupMeeting(code) {
  const res = await apiRequest(`/api/ext/meetings/lookup?code=${encodeURIComponent(code)}`);
  return res?.meeting ?? null;
}

export async function getTodayMeetings() {
  const res = await apiRequest("/api/ext/meetings/today");
  return res?.meetings ?? [];
}

export async function createQuickMeeting({ title, meetingUrl }) {
  const res = await apiRequest("/api/ext/meetings/quick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, meetingUrl }),
  });
  return res?.meeting;
}

export async function checkRecapQuota(meetingId, audioMeta = {}) {
  const res = await apiRequest(`/api/ext/meetings/${meetingId}/recap/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(audioMeta),
  });
  return res?.ok === true;
}

/**
 * Tải file ghi âm lên Vercel Blob và khởi chạy chép lời + tóm tắt biên bản
 */
export async function uploadAndStartRecap({
  meetingId,
  fileBlob,
  fileName,
  durationSeconds,
  token: explicitToken,
  baseUrl: explicitBaseUrl,
}) {
  const config = await getConfig();
  const token = explicitToken || config.token;
  const baseUrl = explicitBaseUrl || config.baseUrl;
  const safeName = fileName || `rec_${meetingId}_${Date.now()}.webm`;
  const pathname = `meetings/${meetingId}/recaps/${safeName}`;

  // 1. Kiểm tra hạn mức trước khi tải
  await checkRecapQuota(meetingId, { durationSeconds, size: fileBlob.size });

  // 2. Xin token upload Blob từ backend
  const uploadTokenRes = await apiRequest(`/api/ext/meetings/${meetingId}/recap/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: {
        pathname,
        callbackUrl: `${baseUrl}/api/ext/meetings/${meetingId}/recap/upload`,
        clientPayload: JSON.stringify({
          token,
          durationSeconds,
          size: fileBlob.size,
        }),
      },
    }),
  });

  if (!uploadTokenRes?.clientToken) {
    throw new Error("Không lấy được token tải file lên kho lưu trữ.");
  }

  // 3. Tải thẳng file lên Vercel Blob API (chuẩn API của Vercel Blob client)
  const blobApiUrl = `https://vercel.com/api/blob/?pathname=${encodeURIComponent(pathname)}`;
  const blobPutResponse = await fetch(blobApiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${uploadTokenRes.clientToken}`,
      "x-api-version": "7",
      "Content-Type": fileBlob.type || "audio/webm",
    },
    body: fileBlob,
  });

  if (!blobPutResponse.ok) {
    const err = await blobPutResponse.text().catch(() => "");
    throw new Error(`Tải file lên Vercel Blob thất bại: ${err || blobPutResponse.statusText}`);
  }

  const uploadedBlob = await blobPutResponse.json().catch(() => ({}));
  const uploadedPathname = uploadedBlob.url || uploadedBlob.pathname || pathname;

  // 4. Kích hoạt xử lý chép lời & tóm tắt biên bản
  const recapRes = await apiRequest(`/api/ext/meetings/${meetingId}/recap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pathname: uploadedPathname,
      fileName: safeName,
      durationSeconds,
    }),
  });

  return recapRes?.recap;
}
