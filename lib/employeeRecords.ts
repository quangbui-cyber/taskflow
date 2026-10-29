import type { Workbook, Worksheet } from "exceljs";
import { BIRTHDAY_STORAGE_YEAR } from "@/lib/birthdays";

// Hồ sơ nhân sự: quyền xem/sửa, chuẩn hoá dữ liệu và đọc file xuất từ phần mềm HR.
// Dữ liệu ở đây là thông tin cá nhân (CCCD, địa chỉ, số điện thoại): không ghi ra log.

export const GENDERS = [
  { key: "MALE", label: "Nam" },
  { key: "FEMALE", label: "Nữ" },
  { key: "OTHER", label: "Khác" },
] as const;

export type GenderKey = (typeof GENDERS)[number]["key"];

export function genderLabel(key: string | null | undefined) {
  return GENDERS.find((gender) => gender.key === key)?.label ?? "";
}

/** Admin luôn quản lý được; ngoài ra là người được Admin giao phụ trách nhân sự. */
export function canManageHr(user: { role?: string | null; isHrManager?: boolean | null }) {
  return user.role === "ADMIN" || user.isHrManager === true;
}

export const FIELD_LIMITS = {
  fullName: 120,
  idNumber: 20,
  address: 300,
  phone: 20,
  employeeCode: 30,
} as const;

function clean(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).normalize("NFC").replace(/\s+/g, " ").trim();
}

/** "LÊ HỒNG YẾN NHI" → "Lê Hồng Yến Nhi"; tên đã viết thường/hoa đúng thì giữ nguyên. */
export function normalizePersonName(value: unknown) {
  const name = clean(value);
  if (!name || name !== name.toLocaleUpperCase("vi")) return name;
  return name
    .toLocaleLowerCase("vi")
    .split(" ")
    .map((word) => word.charAt(0).toLocaleUpperCase("vi") + word.slice(1))
    .join(" ");
}

/** Số CCCD/CMND: chỉ giữ chữ số; ô Excel kiểu số làm mất số 0 đầu thì bù lại cho đủ 12 số. */
export function normalizeIdNumber(value: unknown) {
  if (typeof value === "number") {
    return String(Math.trunc(value)).padStart(12, "0");
  }
  return clean(value).replace(/[^\dA-Za-z]/g, "").toUpperCase();
}

/** Số điện thoại: giữ chữ số và dấu +; số 9 chữ số (mất số 0 đầu) thì thêm 0. */
export function normalizePhone(value: unknown) {
  const phone = clean(typeof value === "number" ? String(Math.trunc(value)) : value).replace(
    /[^\d+]/g,
    ""
  );
  return /^\d{9}$/.test(phone) ? `0${phone}` : phone;
}

/** "•••• 7949" để bảng danh sách không lộ cả số CCCD. */
export function maskIdNumber(idNumber: string | null | undefined) {
  if (!idNumber) return "";
  return idNumber.length <= 4 ? "••••" : `•••• ${idNumber.slice(-4)}`;
}

export function parseGender(value: unknown): GenderKey | null {
  const text = clean(value).toLocaleLowerCase("vi");
  if (!text) return null;
  if (text === "nam" || text === "male") return "MALE";
  if (text === "nữ" || text === "nu" || text === "female") return "FEMALE";
  return "OTHER";
}

/** Ngày dạng dd/mm/yyyy, yyyy-mm-dd hoặc ô ngày của Excel → ngày UTC 00:00. */
export function parseHrDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const text = clean(value);
  let year: number;
  let month: number;
  let day: number;
  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (match) {
    [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (!match) return null;
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    year > 2100 ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Ngày sinh đầy đủ → giá trị User.birthday (chỉ ngày/tháng). */
export function birthdayFromDateOfBirth(dateOfBirth: Date) {
  return new Date(
    Date.UTC(BIRTHDAY_STORAGE_YEAR, dateOfBirth.getUTCMonth(), dateOfBirth.getUTCDate())
  );
}

export function formatHrDate(date: Date | null | undefined) {
  if (!date) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

/** Giá trị cho <input type="date">. */
export function toDateInput(date: Date | null | undefined) {
  return date ? date.toISOString().slice(0, 10) : "";
}

/** Ghép địa chỉ, bỏ phần phường/tỉnh nếu đã có sẵn trong địa chỉ. */
export function joinAddress(parts: unknown[]) {
  const result: string[] = [];
  for (const part of parts.map(clean).filter(Boolean)) {
    const joined = result.join(", ").toLocaleLowerCase("vi");
    if (!joined.includes(part.toLocaleLowerCase("vi"))) result.push(part);
  }
  return result.join(", ");
}

// ---------- Đọc file xuất từ phần mềm HR ----------

export type HrImportRow = {
  employeeCode: string;
  fullName: string;
  email: string;
  status: string;
  /** Có ngày nghỉ việc hoặc trạng thái "Nghỉ việc". */
  hasLeft: boolean;
  dateOfBirth: Date | null;
  gender: GenderKey | null;
  idNumber: string;
  address: string;
  phone: string;
  startDate: Date | null;
};

/** Một dòng xem trước khi nhập (CCCD đã che, không gửi số điện thoại/địa chỉ). */
export type HrImportPreviewRow = {
  key: string;
  employeeCode: string;
  fullName: string;
  email: string;
  outcome: "match" | "no-account" | "left";
  accountName: string | null;
  gender: string;
  dateOfBirth: string;
  startDate: string;
  idNumberMasked: string;
  hasPhone: boolean;
  hasAddress: boolean;
  warnings: string[];
};

export class HrImportError extends Error {}

function headerKey(value: unknown) {
  return clean(value).toLocaleLowerCase("vi");
}

function cellValue(value: unknown): unknown {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const object = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(object.richText)) return object.richText.map((part) => part.text).join("");
    if (object.result !== undefined) return object.result;
    if (object.text !== undefined) return object.text;
  }
  return value;
}

/** Đọc một sheet thành danh sách dòng { tên cột (chữ thường) → giá trị }. */
function readSheet(sheet: Worksheet | undefined) {
  if (!sheet) return [];
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column] = headerKey(cellValue(cell.value));
  });
  const rows: Array<Map<string, unknown>> = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = new Map<string, unknown>();
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      const header = headers[column];
      if (header) values.set(header, cellValue(cell.value));
    });
    rows.push(values);
  });
  return rows;
}

function findSheet(workbook: Workbook, name: string) {
  const key = headerKey(name);
  return workbook.worksheets.find((sheet) => headerKey(sheet.name) === key);
}

const pick = (row: Map<string, unknown> | undefined, column: string) =>
  row?.get(headerKey(column));

/**
 * Đọc file Excel hồ sơ nhân sự. Hỗ trợ 2 định dạng:
 * 1. File mẫu tải từ app (hoặc bảng tổng hợp 1 sheet): có các cột "Họ và tên", "Email", "Số CCCD", "Ngày sinh"...
 * 2. File "Danh sách nhân viên" xuất từ phần mềm HR: ghép các sheet "Tổng quan", "Legals" và "Nhân viên" theo Mã nhân sự.
 * Không đọc sheet Lương (thông tin ngân hàng, lương).
 */
export function parseHrWorkbook(workbook: Workbook): HrImportRow[] {
  // 1. Kiểm tra định dạng nhiều sheet xuất từ phần mềm HR ("Tổng quan" + "Legals" + "Nhân viên")
  const overviewSheet = findSheet(workbook, "Tổng quan");
  const overview = readSheet(overviewSheet);
  const isMultiSheetHr = overview.length > 0 && overview.some((row) => pick(row, "Tên nhân sự"));

  if (isMultiSheetHr) {
    const byCode = (rows: Array<Map<string, unknown>>) =>
      new Map(
        rows
          .map((row) => [clean(pick(row, "Mã nhân sự")), row] as const)
          .filter(([code]) => code)
      );
    const legals = byCode(readSheet(findSheet(workbook, "Legals")));
    const details = byCode(readSheet(findSheet(workbook, "Nhân viên")));

    return overview.flatMap((row) => {
      const fullName = normalizePersonName(pick(row, "Tên nhân sự"));
      if (!fullName) return [];
      const employeeCode = clean(pick(row, "Mã nhân sự"));
      const legal = legals.get(employeeCode);
      const detail = details.get(employeeCode);
      const status = clean(pick(row, "Trạng thái"));
      const email = clean(pick(row, "Địa chỉ email") ?? pick(detail, "Địa chỉ email")).toLowerCase();
      const address =
        joinAddress([
          pick(detail, "Địa chỉ"),
          pick(detail, "Địa chỉ xã/phường"),
          pick(detail, "Địa chỉ tỉnh/tp"),
        ]) || clean(pick(legal, "Địa chỉ"));

      return [
        {
          employeeCode: employeeCode.slice(0, FIELD_LIMITS.employeeCode),
          fullName: fullName.slice(0, FIELD_LIMITS.fullName),
          email,
          status,
          hasLeft:
            status.toLocaleLowerCase("vi").includes("nghỉ việc") ||
            parseHrDate(pick(row, "Ngày nghỉ việc")) !== null,
          dateOfBirth: parseHrDate(pick(row, "Ngày sinh")),
          gender: parseGender(pick(row, "Giới tính")),
          idNumber: normalizeIdNumber(pick(legal, "Số CMT/Căn cước")).slice(0, FIELD_LIMITS.idNumber),
          address: address.slice(0, FIELD_LIMITS.address),
          phone: normalizePhone(pick(row, "Điện thoại") ?? pick(detail, "Điện thoại")).slice(
            0,
            FIELD_LIMITS.phone
          ),
          startDate: parseHrDate(pick(row, "Ngày bắt đầu")),
        },
      ];
    });
  }

  // 2. Kiểm tra định dạng bảng đơn (1 sheet): sheet "Hồ sơ nhân sự", "Nhân sự", hoặc sheet đầu tiên
  const singleSheet =
    findSheet(workbook, "Hồ sơ nhân sự") ??
    findSheet(workbook, "Nhân sự") ??
    workbook.worksheets[0];

  const singleRows = readSheet(singleSheet);
  const hasEmail = singleRows.some(
    (row) => pick(row, "Email") !== undefined || pick(row, "Địa chỉ email") !== undefined
  );
  const hasName = singleRows.some(
    (row) =>
      pick(row, "Họ và tên") !== undefined ||
      pick(row, "Họ tên") !== undefined ||
      pick(row, "Tên nhân sự") !== undefined ||
      pick(row, "Tên") !== undefined
  );

  if (singleRows.length > 0 && hasEmail && hasName) {
    return singleRows.flatMap((row) => {
      const fullName = normalizePersonName(
        pick(row, "Họ và tên") ??
        pick(row, "Họ tên") ??
        pick(row, "Tên nhân sự") ??
        pick(row, "Tên")
      );
      const email = clean(pick(row, "Email") ?? pick(row, "Địa chỉ email")).toLowerCase();
      if (!fullName && !email) return [];

      const status = clean(pick(row, "Trạng thái"));
      const employeeCode = clean(
        pick(row, "Mã nhân sự") ??
        pick(row, "Mã NV") ??
        pick(row, "Mã")
      );
      const idNumberRaw =
        pick(row, "Số CCCD") ??
        pick(row, "CCCD") ??
        pick(row, "Số CMT/Căn cước") ??
        pick(row, "Số CMND") ??
        pick(row, "CMND");
      const phoneRaw =
        pick(row, "Điện thoại") ??
        pick(row, "Số điện thoại") ??
        pick(row, "SĐT") ??
        pick(row, "SDT");
      const startDateRaw =
        pick(row, "Ngày bắt đầu làm việc") ??
        pick(row, "Ngày bắt đầu") ??
        pick(row, "Bắt đầu làm") ??
        pick(row, "Ngày vào làm");

      return [
        {
          employeeCode: employeeCode.slice(0, FIELD_LIMITS.employeeCode),
          fullName: fullName.slice(0, FIELD_LIMITS.fullName),
          email,
          status,
          hasLeft:
            status.toLocaleLowerCase("vi").includes("nghỉ việc") ||
            parseHrDate(pick(row, "Ngày nghỉ việc")) !== null,
          dateOfBirth: parseHrDate(pick(row, "Ngày sinh")),
          gender: parseGender(pick(row, "Giới tính")),
          idNumber: normalizeIdNumber(idNumberRaw).slice(0, FIELD_LIMITS.idNumber),
          address: clean(pick(row, "Địa chỉ")).slice(0, FIELD_LIMITS.address),
          phone: normalizePhone(phoneRaw).slice(0, FIELD_LIMITS.phone),
          startDate: parseHrDate(startDateRaw),
        },
      ];
    });
  }

  throw new HrImportError(
    'Không nhận diện được định dạng file Excel. File cần có các cột: "Họ và tên", "Email", "Số CCCD", "Ngày sinh"... hoặc là file xuất từ phần mềm HR.'
  );
}
