// UI grouping only: keep exact decimal digits, including values beyond Number precision.
export function formatPriceInput(value: string) {
  // Existing source values may use the decimal comma accepted by the money parser.
  const canonical = value.replace(",", ".");
  if (!/^-?\d*(?:\.\d*)?$/.test(canonical)) return value;
  const [whole, fraction] = canonical.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction === undefined ? "" : `.${fraction}`);
}

export function ungroupPriceInput(value: string) {
  return value.replaceAll(",", "");
}
