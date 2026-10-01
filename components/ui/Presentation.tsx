import type { ComponentPropsWithRef, ReactNode } from "react";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export function Badge({ tone = "neutral", className = "", ...props }:
  ComponentPropsWithRef<"span"> & { tone?: Tone }) {
  return <span {...props} className={`tf-badge tf-tone-${tone} ${className}`} />;
}

export function Alert({ tone = "info", title, children, className = "", ...props }:
  Omit<ComponentPropsWithRef<"div">, "title"> & { tone?: Tone; title: string }) {
  return <div role={tone === "danger" ? "alert" : "status"} {...props}
    className={`tf-ui-alert tf-tone-${tone} ${className}`}>
    <p className="font-semibold">{title}</p>
    {children && <div className="mt-1">{children}</div>}
  </div>;
}

export function Panel({ className = "", ...props }: ComponentPropsWithRef<"div">) {
  return <div {...props} className={`tf-panel tf-ui-panel ${className}`} />;
}

export function EmptyState({ title, description, action }:
  { title: string; description?: string; action?: ReactNode }) {
  return <div className="tf-ui-empty">
    <p className="font-semibold">{title}</p>
    {description && <p className="tf-ui-help">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>;
}

export function Table({ caption, children, className = "", ...props }:
  ComponentPropsWithRef<"table"> & { caption: string }) {
  return <div className="tf-ui-table-scroll" tabIndex={0} role="region" aria-label={caption}>
    <table {...props} className={`tf-ui-table ${className}`}>
      <caption>{caption}</caption>{children}
    </table>
  </div>;
}
