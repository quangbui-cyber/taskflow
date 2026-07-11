"use client";

import { useState } from "react";

function format(digits: string): string {
  if (!digits) return "";
  return new Intl.NumberFormat("vi-VN").format(Number(digits));
}

/** Ô nhập tiền VND — tự thêm dấu chấm phân cách hàng ngàn khi gõ */
export default function RevenueInput({
  name,
  defaultValue,
  placeholder,
  className,
}: {
  name: string;
  defaultValue?: number;
  placeholder?: string;
  className?: string;
}) {
  const [value, setValue] = useState(
    defaultValue && defaultValue > 0 ? format(String(defaultValue)) : ""
  );

  return (
    <input
      name={name}
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 15);
        setValue(format(digits));
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}
