"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

export function Dialog({ open, onClose, title, description, children, footer }:
  { open: boolean; onClose: () => void; title: string; description?: string;
    children: ReactNode; footer?: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);

  return <dialog ref={dialogRef} className="tf-ui-dialog" aria-labelledby={titleId}
    aria-describedby={description ? descriptionId : undefined}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        "button, a[href], input, select, textarea, [tabindex]"
      )).filter((element) => element.tabIndex >= 0 && !element.matches(":disabled")
        && element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="tf-ui-dialog-header">
      <h2 id={titleId} className="tf-ui-heading">{title}</h2>
      <Button variant="ghost" size="sm" onClick={onClose} autoFocus>Đóng</Button>
    </div>
    {description && <p id={descriptionId} className="tf-ui-help">{description}</p>}
    <div className="my-5">{children}</div>
    {footer && <div className="tf-ui-actions">{footer}</div>}
  </dialog>;
}
