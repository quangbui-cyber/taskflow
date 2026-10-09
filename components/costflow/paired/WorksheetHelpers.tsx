"use client";

import { useLayoutEffect, useRef } from "react";
import { Plus } from "lucide-react";
import {
  displayMoney,
  exact,
  subtract,
  source as moneySource,
  divide,
  multiply,
  decimal,
  round
} from "@/lib/costflow/money";
import { formatPriceInput, ungroupPriceInput } from "@/lib/costflow/inputFormat";

export const PERCENT_FORMATTER = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

export function calcRowMargin(
  sellCost: { net: string; rawNet: string } | null | undefined,
  buyCost: { net: string; rawNet: string } | null | undefined
): {
  marginDisplay: string;
  percentDisplay: string;
  percentNum: number;
  hasData: boolean;
  isPositive: boolean;
} | null {
  if (!sellCost || !buyCost || sellCost.rawNet === undefined || buyCost.rawNet === undefined) {
    return null;
  }
  try {
    const sNet = exact(sellCost.rawNet);
    const bNet = exact(buyCost.rawNet);
    const diff = subtract(sNet, bNet);
    const isPositive = diff.numerator >= BigInt(0);
    const marginDisplay = displayMoney(moneySource(diff));
    if (sNet.numerator === BigInt(0)) {
      return {
        marginDisplay,
        percentDisplay: "0%",
        percentNum: 0,
        hasData: true,
        isPositive
      };
    }
    const pctRatio = Number(round(multiply(divide(diff, sNet), decimal("10000")))) / 100;
    return {
      marginDisplay,
      percentDisplay: PERCENT_FORMATTER.format(pctRatio) + "%",
      percentNum: pctRatio,
      hasData: true,
      isPositive
    };
  } catch {
    return null;
  }
}

export function PairedInsertMenu({ actions }: { actions: { label: string; onSelect: () => void }[] }) {
  return (
    <div className="tf-quotation-row-menu tf-quotation-insert-menu" role="menu">
      {actions.map(action => (
        <button key={action.label} type="button" role="menuitem" onClick={action.onSelect}>
          <Plus size={14} aria-hidden="true" />
          {action.label}
        </button>
      ))}
    </div>
  );
}

export function PairedPriceInput({
  label,
  value,
  disabled,
  rowId,
  scope,
  onChange,
  onNext
}: {
  label: string;
  value: string;
  disabled?: boolean;
  rowId: string;
  scope: "sell" | "buy";
  onChange: (value: string) => void;
  onNext: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const display = formatPriceInput(value);
  useLayoutEffect(() => {
    if (caret.current === null || !input.current) return;
    let index = 0,
      digits = 0;
    while (index < display.length && digits < caret.current) {
      if (display[index] !== ",") digits++;
      index++;
    }
    input.current.setSelectionRange(index, index);
    caret.current = null;
  }, [display]);
  return (
    <input
      ref={input}
      aria-label={label}
      inputMode="decimal"
      placeholder="—"
      data-price-row={rowId}
      data-price-scope={scope}
      className={`w-full text-right font-mono text-xs py-1 px-1.5 rounded border border-transparent hover:border-[var(--border)] focus:border-[var(--focus-ring)] focus:bg-[var(--surface)] bg-transparent transition-colors tabular-nums${
        display ? "" : " text-[var(--muted)]"
      }`}
      value={display}
      disabled={disabled}
      onKeyDown={event => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onNext();
        }
      }}
      onChange={event => {
        caret.current = ungroupPriceInput(
          event.target.value.slice(0, event.target.selectionStart ?? event.target.value.length)
        ).length;
        onChange(ungroupPriceInput(event.target.value));
      }}
    />
  );
}
