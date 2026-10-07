// Exact source arithmetic. No binary Float, display rounding, or summing rounded rows.
export type Rational = { numerator: bigint; denominator: bigint };
const ZERO = BigInt(0);
const ONE = BigInt(1);

function rational(numerator: bigint, denominator = ONE): Rational {
  if (denominator === ZERO) throw new Error("Mẫu số không hợp lệ.");
  if (denominator < ZERO) { numerator = -numerator; denominator = -denominator; }
  let a = numerator < ZERO ? -numerator : numerator;
  let b = denominator;
  while (b !== ZERO) { const rest = a % b; a = b; b = rest; }
  return { numerator: numerator / a, denominator: denominator / a };
}

export function decimal(value: string): Rational {
  const text = value.trim().replace(",", ".");
  if (text.length > 128 || !/^-?\d+(?:\.\d+)?$/.test(text)) {
    throw new Error("Nhập số hợp lệ, không dùng dấu phân cách hàng nghìn.");
  }
  const [whole, fraction = ""] = text.split(".");
  return rational(BigInt(whole + fraction), BigInt(10) ** BigInt(fraction.length));
}

export function exact(value: string): Rational {
  if (!value.includes("/")) return decimal(value);
  const parts = value.split("/");
  if (parts.length !== 2 || !/^-?\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) throw new Error("Số gốc không hợp lệ.");
  return rational(BigInt(parts[0]), BigInt(parts[1]));
}

export function source(value: Rational): string {
  return `${value.numerator}/${value.denominator}`;
}

export function add(a: Rational, b: Rational) {
  return rational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
}
export function subtract(a: Rational, b: Rational) { return add(a, rational(-b.numerator, b.denominator)); }
export function multiply(a: Rational, b: Rational) { return rational(a.numerator * b.numerator, a.denominator * b.denominator); }
export function divide(a: Rational, b: Rational) { return rational(a.numerator * b.denominator, a.denominator * b.numerator); }
export function sum(values: Rational[]) { return values.reduce(add, rational(ZERO)); }
export function compare(a: Rational, b: Rational) {
  const diff = a.numerator * b.denominator - b.numerator * a.denominator;
  return diff < ZERO ? -1 : diff > ZERO ? 1 : 0;
}

export function round(value: Rational): string {
  const abs = value.numerator < ZERO ? -value.numerator : value.numerator;
  const result = (BigInt(2) * abs + value.denominator) / (BigInt(2) * value.denominator);
  return (value.numerator < ZERO ? -result : result).toString();
}

export type CostInput = { quantity: string; unitPrice: string; basis: "NET" | "GROSS"; vatPercent: string };
export type CalculatedCost = { rawNet: string; rawVat: string; rawGross: string; net: string; vat: string; gross: string };

export function calculateCost(input: CostInput): CalculatedCost {
  if (!['NET', 'GROSS'].includes(input.basis)) throw new Error("Chọn net hoặc gross.");
  const quantity = decimal(input.quantity);
  const unit = decimal(input.unitPrice);
  const rate = divide(decimal(input.vatPercent), decimal("100"));
  if (quantity.numerator < ZERO || unit.numerator < ZERO || rate.numerator < ZERO) throw new Error("Số lượng, đơn giá và VAT không được âm.");
  const amount = multiply(quantity, unit);
  const net = input.basis === "NET" ? amount : divide(amount, add(decimal("1"), rate));
  const vat = multiply(net, rate);
  const gross = add(net, vat);
  return { rawNet: source(net), rawVat: source(vat), rawGross: source(gross), net: round(net), vat: round(vat), gross: round(gross) };
}

export function totals(rows: CalculatedCost[]) {
  const net = sum(rows.map(row => exact(row.rawNet)));
  const vat = sum(rows.map(row => exact(row.rawVat)));
  const gross = sum(rows.map(row => exact(row.rawGross)));
  return { rawNet: source(net), rawVat: source(vat), rawGross: source(gross), net: round(net), vat: round(vat), gross: round(gross) };
}

export function displayMoney(value: string) {
  const integer = round(exact(value));
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")} ₫`;
}

const DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
function readGroup(value: number, full: boolean): string {
  const h = Math.floor(value / 100), t = Math.floor(value / 10) % 10, u = value % 10;
  const parts: string[] = [];
  if (h || full) parts.push(DIGITS[h], "trăm");
  if (t > 1) parts.push(DIGITS[t], "mươi");
  else if (t === 1) parts.push("mười");
  else if ((h || full) && u) parts.push("lẻ");
  if (u) parts.push(u === 1 && t > 1 ? "mốt" : u === 5 && t > 0 ? "lăm" : DIGITS[u]);
  return parts.join(" ");
}
export function moneyInWords(value: string) {
  let n = BigInt(round(exact(value)));
  const negative = n < ZERO;
  if (negative) n = -n;
  if (n === ZERO) return "Không đồng";
  const groups: number[] = [];
  while (n > ZERO) { groups.push(Number(n % BigInt(1000))); n /= BigInt(1000); }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    const prefix = ["", "nghìn", "triệu"][i % 3];
    const billions = Array(Math.floor(i / 3)).fill("tỷ").join(" ");
    parts.push([readGroup(groups[i], i < groups.length - 1), prefix, billions].filter(Boolean).join(" "));
  }
  const text = `${negative ? "âm " : ""}${parts.join(" ")} đồng`;
  return text[0].toUpperCase() + text.slice(1);
}
