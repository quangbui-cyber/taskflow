const AVATAR_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export const MAX_AVATAR_DATA_URL_LENGTH = 450_000;

export function parseAvatarDataUrl(value: unknown): {
  avatarUrl: string | null;
  error?: string;
} {
  const avatarUrl = String(value ?? "").trim();
  if (!avatarUrl) return { avatarUrl: null };

  if (
    avatarUrl.length > MAX_AVATAR_DATA_URL_LENGTH ||
    !AVATAR_DATA_URL.test(avatarUrl)
  ) {
    return {
      avatarUrl: null,
      error: "Ảnh đại diện không hợp lệ hoặc có dung lượng quá lớn.",
    };
  }

  return { avatarUrl };
}
