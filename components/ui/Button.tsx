import type { ComponentPropsWithRef } from "react";

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  loadingLabel?: string;
};

export function Button({ variant = "primary", size = "md", loading = false,
  loadingLabel = "Đang xử lý…", disabled, type = "button", className = "",
  children, ...props }: ButtonProps) {
  return (
    <button {...props} type={type} disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`tf-button-${variant} tf-button-size-${size} ${className}`}>
      {loading && <span className="tf-spinner" aria-hidden="true" />}
      {loading ? loadingLabel : children}
    </button>
  );
}

export function IconButton({ "aria-label": label, className = "", ...props }:
  Omit<ButtonProps, "children"> & { "aria-label": string; children: React.ReactNode }) {
  return <Button {...props} aria-label={label} className={`tf-ui-icon-button ${className}`} />;
}
