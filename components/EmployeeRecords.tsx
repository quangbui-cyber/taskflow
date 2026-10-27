"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Pencil, Plus, Search, TriangleAlert, X } from "lucide-react";
import {
  saveEmployeeRecord,
  setHrManagers,
  type EmployeeRecordState,
} from "@/app/actions/employeeRecords";
import Avatar from "@/components/Avatar";
import { useActionFeedback, useInteraction } from "@/components/InteractionProvider";
import {
  GENDERS,
  genderLabel,
  maskIdNumber,
  type HrImportPreviewRow,
} from "@/lib/employeeRecords";

export type EmployeeRow = {
  userId: string;
  accountName: string;
  email: string;
  avatarUrl: string | null;
  record: {
    fullName: string;
    gender: string | null;
    /** yyyy-mm-dd */
    dateOfBirth: string;
    idNumber: string | null;
    address: string | null;
    phone: string | null;
    /** yyyy-mm-dd */
    startDate: string;
  } | null;
};

function displayDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function Dialog({
  title,
  labelledBy,
  onClose,
  busy,
  wide = false,
  children,
}: {
  title: string;
  labelledBy: string;
  onClose: () => void;
  busy: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [busy, onClose]);

  return (
    <div
      className="tf-overlay-enter fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`tf-modal-enter max-h-[calc(100vh-32px)] w-full overflow-y-auto rounded-[12px] border border-zinc-200 bg-white shadow-2xl ${
          wide ? "max-w-4xl" : "max-w-xl"
        }`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <h2 id={labelledBy} className="text-lg font-semibold text-zinc-900">
            {title}
          </h2>
          <button
            type="button"
            className="tf-icon-button shrink-0"
            onClick={onClose}
            disabled={busy}
            aria-label="Đóng"
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function EditDialog({ row, onClose }: { row: EmployeeRow; onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<EmployeeRecordState, FormData>(
    saveEmployeeRecord,
    {}
  );
  useActionFeedback(state);

  useEffect(() => {
    if (!state.success) return;
    router.refresh();
    onClose();
  }, [onClose, router, state]);

  const record = row.record;
  return (
    <Dialog
      title={`Hồ sơ nhân sự · ${row.accountName}`}
      labelledBy={`hr-edit-${row.userId}`}
      onClose={onClose}
      busy={pending}
    >
      <form action={formAction} className="grid gap-4 px-5 py-5 sm:grid-cols-2">
        <input type="hidden" name="userId" value={row.userId} />
        <label className="block sm:col-span-2">
          <span className="tf-label">Họ tên</span>
          <input
            name="fullName"
            required
            maxLength={120}
            defaultValue={record?.fullName ?? row.accountName}
            className="tf-field"
          />
        </label>
        <label className="block">
          <span className="tf-label">Ngày sinh</span>
          <input type="date" name="dateOfBirth" defaultValue={record?.dateOfBirth ?? ""} className="tf-field" />
        </label>
        <label className="block">
          <span className="tf-label">Giới tính</span>
          <select name="gender" defaultValue={record?.gender ?? ""} className="tf-field">
            <option value="">Chưa chọn</option>
            {GENDERS.map((gender) => (
              <option key={gender.key} value={gender.key}>
                {gender.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="tf-label">Số CCCD</span>
          <input
            name="idNumber"
            inputMode="numeric"
            maxLength={20}
            autoComplete="off"
            defaultValue={record?.idNumber ?? ""}
            className="tf-field"
          />
        </label>
        <label className="block">
          <span className="tf-label">Số điện thoại</span>
          <input
            name="phone"
            type="tel"
            maxLength={20}
            autoComplete="off"
            defaultValue={record?.phone ?? ""}
            className="tf-field"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="tf-label">Địa chỉ</span>
          <textarea
            name="address"
            maxLength={300}
            rows={2}
            defaultValue={record?.address ?? ""}
            className="tf-field resize-y leading-6"
          />
        </label>
        <label className="block">
          <span className="tf-label">Ngày bắt đầu làm việc</span>
          <input type="date" name="startDate" defaultValue={record?.startDate ?? ""} className="tf-field" />
        </label>
        <div className="flex items-end justify-end gap-2.5 sm:col-span-2">
          <button type="button" className="tf-button-secondary" onClick={onClose} disabled={pending}>
            Huỷ
          </button>
          <button type="submit" className="tf-button-primary" disabled={pending} aria-busy={pending}>
            {pending ? <span className="tf-spinner" aria-hidden="true" /> : null}
            {pending ? "Đang lưu…" : "Lưu hồ sơ"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const OUTCOME_LABEL: Record<HrImportPreviewRow["outcome"], string> = {
  match: "Sẽ cập nhật",
  "no-account": "Chưa có tài khoản",
  left: "Đã nghỉ việc",
};

export function HrImportButton() {
  const router = useRouter();
  const { notify } = useInteraction();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ rows: HrImportPreviewRow[]; matchCount: number } | null>(
    null
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function close() {
    setOpen(false);
    setFile(null);
    setPreview(null);
    setError("");
  }

  async function send(confirm: boolean) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      if (confirm) body.set("confirm", "1");
      const response = await fetch("/api/hr/import", { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Không nhập được file.");
        return;
      }
      if (confirm) {
        notify({ message: `Đã cập nhật hồ sơ cho ${data.saved} nhân sự.`, tone: "success" });
        router.refresh();
        close();
      } else {
        setPreview({ rows: data.rows, matchCount: data.matchCount });
      }
    } catch {
      setError("Mất kết nối. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  const sorted = useMemo(() => {
    const order = { match: 0, "no-account": 1, left: 2 } as const;
    return [...(preview?.rows ?? [])].sort((a, b) => order[a.outcome] - order[b.outcome]);
  }, [preview]);

  return (
    <>
      <button type="button" className="tf-button-primary" onClick={() => setOpen(true)}>
        <FileUp size={17} aria-hidden="true" />
        Nhập từ Excel
      </button>
      {open && (
        <Dialog
          title="Nhập hồ sơ từ file Excel"
          labelledBy="hr-import-title"
          onClose={close}
          busy={busy}
          wide
        >
          <div className="space-y-4 px-5 py-5">
            <p className="text-sm text-zinc-700">
              Chọn file danh sách nhân viên xuất từ phần mềm HR (.xlsx). App đọc họ tên, ngày
              sinh, giới tính, CCCD, địa chỉ, điện thoại và ngày bắt đầu, rồi ghép với tài khoản
              trùng email. Ô trống trong file không xoá dữ liệu đã có. File không được lưu lại.
            </p>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setError("");
              }}
              className="block w-full text-sm file:mr-3 file:rounded-[8px] file:border-0 file:bg-brand-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-800"
            />
            {error && (
              <p className="rounded-[8px] bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}
            {preview && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-zinc-900">
                  {preview.matchCount} nhân sự sẽ được cập nhật · {preview.rows.length - preview.matchCount}{" "}
                  dòng bỏ qua
                </p>
                <div className="max-h-[50vh] overflow-auto rounded-[8px] border border-zinc-200">
                  <table className="w-full min-w-[640px] text-left text-[13px]">
                    <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-600">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Nhân sự</th>
                        <th className="px-3 py-2 font-semibold">Kết quả</th>
                        <th className="px-3 py-2 font-semibold">Ngày sinh</th>
                        <th className="px-3 py-2 font-semibold">Giới tính</th>
                        <th className="px-3 py-2 font-semibold">CCCD</th>
                        <th className="px-3 py-2 font-semibold">Bắt đầu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((row) => (
                        <tr key={row.key} className="border-t border-zinc-100 align-top">
                          <td className="px-3 py-2">
                            <b className="block text-zinc-900">{row.fullName}</b>
                            <span className="text-xs text-zinc-500">{row.email || "Không có email"}</span>
                            {row.warnings.map((warning) => (
                              <span key={warning} className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                                <TriangleAlert size={12} aria-hidden="true" />
                                {warning}
                              </span>
                            ))}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                                row.outcome === "match"
                                  ? "bg-brand-100 text-brand-800"
                                  : "bg-zinc-100 text-zinc-600"
                              }`}
                            >
                              {OUTCOME_LABEL[row.outcome]}
                            </span>
                          </td>
                          <td className="px-3 py-2 tabular-nums">{row.dateOfBirth}</td>
                          <td className="px-3 py-2">{row.gender}</td>
                          <td className="px-3 py-2 tabular-nums">{row.idNumberMasked}</td>
                          <td className="px-3 py-2 tabular-nums">{row.startDate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2.5">
              <button type="button" className="tf-button-secondary" onClick={close} disabled={busy}>
                Huỷ
              </button>
              {preview ? (
                <button
                  type="button"
                  className="tf-button-primary"
                  disabled={busy || preview.matchCount === 0}
                  onClick={() => send(true)}
                  aria-busy={busy}
                >
                  {busy && <span className="tf-spinner" aria-hidden="true" />}
                  Lưu {preview.matchCount} hồ sơ
                </button>
              ) : (
                <button
                  type="button"
                  className="tf-button-primary"
                  disabled={busy || !file}
                  onClick={() => send(false)}
                  aria-busy={busy}
                >
                  {busy && <span className="tf-spinner" aria-hidden="true" />}
                  Xem trước
                </button>
              )}
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function EmployeeRecordTable({ rows }: { rows: EmployeeRow[] }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("vi");
    if (!text) return rows;
    return rows.filter((row) =>
      [row.accountName, row.email, row.record?.fullName ?? "", row.record?.phone ?? ""].some((value) =>
        value.toLocaleLowerCase("vi").includes(text)
      )
    );
  }, [query, rows]);

  return (
    <section className="rounded-[14px] border border-zinc-200 bg-white">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
        <Search size={16} className="text-zinc-400" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm theo tên, email, số điện thoại…"
          aria-label="Tìm nhân sự"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-[13px]">
          <thead className="bg-zinc-50 text-xs text-zinc-600">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Họ tên</th>
              <th className="px-3 py-2.5 font-semibold">Ngày sinh</th>
              <th className="px-3 py-2.5 font-semibold">Giới tính</th>
              <th className="px-3 py-2.5 font-semibold">CCCD</th>
              <th className="px-3 py-2.5 font-semibold">Điện thoại</th>
              <th className="px-3 py-2.5 font-semibold">Địa chỉ</th>
              <th className="px-3 py-2.5 font-semibold">Bắt đầu làm</th>
              <th className="px-3 py-2.5" aria-label="Thao tác" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.userId} className="border-t border-zinc-100 align-middle">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <Avatar id={row.userId} name={row.accountName} avatarUrl={row.avatarUrl} className="h-8 w-8 text-[11px]" />
                    <span className="min-w-0">
                      <b className="block truncate text-zinc-900">{row.record?.fullName ?? row.accountName}</b>
                      <span className="block truncate text-xs text-zinc-500">{row.email}</span>
                    </span>
                  </span>
                </td>
                {row.record ? (
                  <>
                    <td className="px-3 py-2.5 tabular-nums">{displayDate(row.record.dateOfBirth)}</td>
                    <td className="px-3 py-2.5">{genderLabel(row.record.gender)}</td>
                    <td className="px-3 py-2.5 tabular-nums" title="Mở Sửa để xem đủ số">
                      {maskIdNumber(row.record.idNumber)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{row.record.phone}</td>
                    <td className="max-w-[260px] truncate px-3 py-2.5" title={row.record.address ?? ""}>
                      {row.record.address}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{displayDate(row.record.startDate)}</td>
                  </>
                ) : (
                  <td colSpan={6} className="px-3 py-2.5 text-zinc-500">
                    Chưa có hồ sơ
                  </td>
                )}
                <td className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => setEditing(row)}
                    className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-brand-700 hover:bg-brand-50"
                  >
                    {row.record ? <Pencil size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                    <span className="text-[13px] font-semibold">{row.record ? "Sửa" : "Thêm"}</span>
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-zinc-500">
                  Không tìm thấy nhân sự phù hợp.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && <EditDialog row={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

export function HrManagerPicker({
  users,
  selectedIds,
}: {
  users: Array<{ id: string; name: string }>;
  selectedIds: string[];
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>(selectedIds);

  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
    setSelected(next);
    startTransition(async () => {
      const result = await setHrManagers(next);
      if (result.error) {
        notify({ message: result.error, tone: "error" });
        setSelected(selected);
      } else {
        notify({ message: result.success ?? "Đã lưu.", tone: "success" });
        router.refresh();
      }
    });
  }

  return (
    <details className="rounded-[12px] border border-zinc-200 bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-800">
        Người phụ trách nhân sự ({selected.length}) · chỉ Admin thấy mục này
      </summary>
      <p className="mt-2 text-xs text-zinc-600">
        Người được chọn sẽ thấy tab Hồ sơ nhân sự và sửa được hồ sơ của mọi người.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {users.map((user) => {
          const active = selected.includes(user.id);
          return (
            <button
              key={user.id}
              type="button"
              disabled={pending}
              aria-pressed={active}
              onClick={() => toggle(user.id)}
              className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${
                active
                  ? "border-brand-400 bg-brand-100 font-semibold text-brand-800"
                  : "border-zinc-200 text-zinc-700 hover:border-brand-300"
              }`}
            >
              {user.name}
            </button>
          );
        })}
      </div>
    </details>
  );
}
