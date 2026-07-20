export const MIN_PASSWORD_LENGTH = 10;

export function passwordLengthError(password: string) {
  return password.length < MIN_PASSWORD_LENGTH
    ? `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`
    : null;
}
