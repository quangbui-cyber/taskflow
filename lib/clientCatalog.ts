export const CLIENT_NAME_MAX_LENGTH = 160;

export function normalizeClientName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function clientNameKey(value: string) {
  return normalizeClientName(value).toLowerCase();
}

export function clientNameError(value: string) {
  const name = normalizeClientName(value);
  if (!name) return "Tên Client không được để trống.";
  if (name.length > CLIENT_NAME_MAX_LENGTH) {
    return `Tên Client không được dài quá ${CLIENT_NAME_MAX_LENGTH} ký tự.`;
  }
  return null;
}

export function canCreateClient(role: string) {
  return role === "ADMIN" || role === "ACCOUNT";
}
