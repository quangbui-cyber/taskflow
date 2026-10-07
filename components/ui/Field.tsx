"use client";

import { useId, type ComponentPropsWithRef, type ReactNode } from "react";

type FieldInfo = { label?: string; hint?: ReactNode; error?: string };

function useFieldInfo(id: string | undefined, describedBy: string | undefined,
  hint: ReactNode, error: string | undefined) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return { fieldId, describedBy: [describedBy, hint ? `${fieldId}-hint` : "",
    error ? `${fieldId}-error` : ""].filter(Boolean).join(" ") || undefined };
}

function FieldFrame({ id, label, hint, error, required, children }:
  FieldInfo & { id: string; required?: boolean; children: ReactNode }) {
  return <div className="tf-ui-field-group">
    {label && <label className="tf-label" htmlFor={id}>{label}{required && <span> (bắt buộc)</span>}</label>}
    {children}
    {hint && <p className="tf-ui-help" id={`${id}-hint`}>{hint}</p>}
    {error && <p className="tf-ui-error" id={`${id}-error`}>{error}</p>}
  </div>;
}

export function Input({ label, hint, error, id, className = "", ...props }:
  ComponentPropsWithRef<"input"> & FieldInfo) {
  const info = useFieldInfo(id, props["aria-describedby"], hint, error);
  return <FieldFrame id={info.fieldId} label={label} hint={hint} error={error} required={props.required}>
    <input {...props} id={info.fieldId} aria-describedby={info.describedBy}
      aria-invalid={error ? true : props["aria-invalid"]} className={`tf-field ${className}`} />
  </FieldFrame>;
}

export function Select({ label, hint, error, id, className = "", children, ...props }:
  ComponentPropsWithRef<"select"> & FieldInfo) {
  const info = useFieldInfo(id, props["aria-describedby"], hint, error);
  return <FieldFrame id={info.fieldId} label={label} hint={hint} error={error} required={props.required}>
    <select {...props} id={info.fieldId} aria-describedby={info.describedBy}
      aria-invalid={error ? true : props["aria-invalid"]} className={`tf-field ${className}`}>{children}</select>
  </FieldFrame>;
}

export function Textarea({ label, hint, error, id, className = "", ...props }:
  ComponentPropsWithRef<"textarea"> & FieldInfo) {
  const info = useFieldInfo(id, props["aria-describedby"], hint, error);
  return <FieldFrame id={info.fieldId} label={label} hint={hint} error={error} required={props.required}>
    <textarea rows={4} {...props} id={info.fieldId} aria-describedby={info.describedBy}
      aria-invalid={error ? true : props["aria-invalid"]} className={`tf-field ${className}`} />
  </FieldFrame>;
}
