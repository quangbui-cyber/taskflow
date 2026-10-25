"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CopyPlus, History, Search, Send, Undo2, X } from "lucide-react";
import {
  approveFinanceSheet,
  createNextFinanceVersion,
  rejectFinanceSheet,
  submitFinanceSheet,
  withdrawFinanceSheet,
  type FinanceApprovalState,
} from "@/app/actions/financeApproval";
import Avatar from "@/components/Avatar";
import { useInteraction } from "@/components/InteractionProvider";
import type { FinanceSheetView } from "@/lib/financeSheet";

export type CcCandidate = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  roleLabel: string;
  /** Được xem giá bán; không thì email bỏ giá bán, lợi nhuận, margin. */
  seesSell: boolean;
};

export type FinanceApprovalProps = {
  projectId: string;
  viewerId: string;
  approver: { id: string; name: string } | null;
  canEdit: boolean;
  canDecide: boolean;
  canWithdraw: boolean;
  ccCandidates: CcCandidate[];
  defaultCcIds: string[];
};

const STATUS: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Bản nháp", className: "bg-zinc-100 text-zinc-700" },
  SUBMITTED: { label: "Chờ duyệt", className: "bg-amber-50 text-amber-800" },
  APPROVED: { label: "Đã duyệt", className: "bg-emerald-50 text-emerald-700" },
  REJECTED: { label: "Bị từ chối", className: "bg-red-50 text-red-700" },
};

const ACTION_LABEL: Record<string, string> = {
  SUBMIT: "gửi duyệt",
  WITHDRAW: "rút lại",
  APPROVE: "duyệt",
  REJECT: "từ chối",
  NEW_VERSION: "tạo phiên bản mới",
};

const TIME_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "25/10/2026 15:49" theo giờ Việt Nam. */
function formatTime(iso: string) {
  const part = Object.fromEntries(TIME_PARTS.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${part.day}/${part.month}/${part.year} ${part.hour}:${part.minute}`;
}

function searchKey(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();
}

export default function FinanceApprovalBar({
  sheet,
  dirty,
  props,
}: {
  sheet: FinanceSheetView;
  dirty: boolean;
  props: FinanceApprovalProps;
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"submit" | "reject" | null>(null);
  const status = STATUS[sheet.icStatus] ?? STATUS.DRAFT;
  const { approval } = sheet;
  const canSubmit = props.canEdit && (sheet.icStatus === "DRAFT" || sheet.icStatus === "REJECTED");
  const selfApproval = approval.submittedById === props.viewerId;

  function run(action: () => Promise<FinanceApprovalState>, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        notify({ message: result.error, tone: "error" });
        return;
      }
      notify({ message: result.success ?? "Đã cập nhật.", tone: "success" });
      after?.();
      router.refresh();
    });
  }

  return (
    <section aria-label="Duyệt IC" className="tf-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">IC v{sheet.version}</span>
            <span className={`tf-badge ${status.className}`}>{status.label}</span>
          </div>
          <p className="text-sm text-zinc-600">
            {sheet.icStatus === "SUBMITTED" && approval.submittedAt
              ? `${approval.submittedByName ?? "Ai đó"} gửi lúc ${formatTime(approval.submittedAt)} · đang chờ ${props.approver?.name ?? "người duyệt"} duyệt.`
              : sheet.icStatus === "APPROVED" && approval.approvedAt
                ? `${approval.approvedByName ?? "Người duyệt"} đã duyệt lúc ${formatTime(approval.approvedAt)}. Doanh thu dự án lấy theo IC này.`
                : props.approver
                  ? `Người duyệt: ${props.approver.name}.`
                  : "Dự án chưa có người duyệt IC — vào nút \"Sửa\" của dự án để chọn trước khi gửi duyệt."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canSubmit && (
            <button
              type="button"
              disabled={pending || dirty || !props.approver}
              title={dirty ? "Lưu IC trước khi gửi duyệt" : undefined}
              onClick={() => setDialog("submit")}
              className="tf-button-primary"
            >
              <Send size={16} aria-hidden="true" />
              Gửi duyệt
            </button>
          )}
          {sheet.icStatus === "SUBMITTED" && props.canDecide && (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const text = selfApproval
                    ? "Bạn cũng là người gửi IC này. Không có người thứ hai kiểm tra trước khi duyệt. Vẫn duyệt? (sẽ ghi vào lịch sử)"
                    : `Duyệt IC v${sheet.version}? Doanh thu dự án sẽ cập nhật theo IC này.`;
                  if (!confirm(text)) return;
                  run(() => approveFinanceSheet(props.projectId, sheet.id));
                }}
                className="tf-button-primary"
              >
                <Check size={16} aria-hidden="true" />
                Duyệt
              </button>
              <button type="button" disabled={pending} onClick={() => setDialog("reject")} className="tf-button-secondary">
                <X size={16} aria-hidden="true" />
                Từ chối
              </button>
            </>
          )}
          {sheet.icStatus === "SUBMITTED" && props.canWithdraw && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!confirm("Rút lại IC về bản nháp? Người duyệt sẽ nhận email báo đã rút lại.")) return;
                run(() => withdrawFinanceSheet(props.projectId, sheet.id));
              }}
              className="tf-button-secondary"
            >
              <Undo2 size={16} aria-hidden="true" />
              Rút lại
            </button>
          )}
          {sheet.icStatus === "APPROVED" && props.canEdit && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!confirm(`Tạo IC v${sheet.version + 1} (bản nháp) từ bản đã duyệt để sửa? Bản v${sheet.version} vẫn được giữ.`)) return;
                run(() => createNextFinanceVersion(props.projectId, sheet.id));
              }}
              className="tf-button-secondary"
            >
              <CopyPlus size={16} aria-hidden="true" />
              Tạo phiên bản mới
            </button>
          )}
        </div>
      </div>

      {sheet.icStatus === "REJECTED" && approval.rejectReason && (
        <p className="mt-3 rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <b>Lý do từ chối:</b> {approval.rejectReason}
        </p>
      )}
      {canSubmit && dirty && (
        <p className="mt-3 text-xs text-amber-700">Lưu IC trước khi gửi duyệt.</p>
      )}

      {approval.events.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="inline-flex cursor-pointer items-center gap-1.5 text-zinc-600 hover:text-zinc-900">
            <History size={14} aria-hidden="true" />
            Lịch sử duyệt ({approval.events.length})
          </summary>
          <ol className="mt-2 space-y-1.5 border-l border-zinc-200 pl-4">
            {approval.events.map((event) => (
              <li key={event.id} className="text-zinc-700">
                <span className="text-xs text-zinc-500">{formatTime(event.createdAt)}</span>{" "}
                <b>{event.actorName ?? "Ai đó"}</b> {ACTION_LABEL[event.action] ?? event.action}
                {event.selfApproval && (
                  <>{" "}<span className="tf-badge bg-amber-50 text-amber-800">Tự gửi – tự duyệt</span></>
                )}
                {event.note && <span className="text-zinc-500"> — {event.note}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}

      {dialog === "submit" && props.approver && (
        <SubmitDialog
          approver={props.approver}
          candidates={props.ccCandidates}
          defaultCcIds={props.defaultCcIds}
          pending={pending}
          onClose={() => setDialog(null)}
          onSubmit={(ccUserIds, message) =>
            run(
              () => submitFinanceSheet(props.projectId, sheet.id, { ccUserIds, message }),
              () => setDialog(null),
            )
          }
        />
      )}
      {dialog === "reject" && (
        <RejectDialog
          pending={pending}
          onClose={() => setDialog(null)}
          onReject={(reason) =>
            run(() => rejectFinanceSheet(props.projectId, sheet.id, reason), () => setDialog(null))
          }
        />
      )}
    </section>
  );
}

function Overlay({ children, onClose, labelledBy }: { children: React.ReactNode; onClose: () => void; labelledBy: string }) {
  return (
    <div
      className="tf-overlay-enter fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-zinc-950/35 p-4 backdrop-blur-[2px] sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(event) => event.stopPropagation()}
        className="tf-modal-enter my-auto w-full max-w-lg space-y-4 rounded-[10px] border border-zinc-200 bg-white p-6 shadow-xl"
      >
        {children}
      </div>
    </div>
  );
}

function SubmitDialog({
  approver,
  candidates,
  defaultCcIds,
  pending,
  onClose,
  onSubmit,
}: {
  approver: { id: string; name: string };
  candidates: CcCandidate[];
  defaultCcIds: string[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (ccUserIds: string[], message: string) => void;
}) {
  const [cc, setCc] = useState<Set<string>>(() => new Set(defaultCcIds));
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const approverInfo = candidates.find((person) => person.id === approver.id);
  const visible = useMemo(() => {
    const needle = searchKey(query.trim());
    return candidates.filter(
      (person) =>
        person.id !== approver.id &&
        (!needle || searchKey(`${person.name} ${person.email}`).includes(needle)),
    );
  }, [approver.id, candidates, query]);
  const chosen = candidates.filter((person) => cc.has(person.id));
  const hidesSell = chosen.some((person) => !person.seesSell) || (approverInfo ? !approverInfo.seesSell : false);

  return (
    <Overlay onClose={onClose} labelledBy="submit-ic-title">
      <div className="flex items-center justify-between">
        <h2 id="submit-ic-title" className="text-lg font-semibold">Gửi IC đi duyệt</h2>
        <button type="button" onClick={onClose} className="tf-icon-button !h-9 !min-h-9 !w-9" aria-label="Đóng">
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      <div>
        <span className="tf-label">Gửi tới (người duyệt IC của dự án)</span>
        <div className="flex items-center gap-2 rounded-[7px] border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
          <Avatar id={approver.id} name={approver.name} avatarUrl={approverInfo?.avatarUrl ?? null} className="h-6 w-6 text-[11px]" />
          <span className="font-medium">{approver.name}</span>
          {approverInfo && <span className="text-xs text-zinc-500">{approverInfo.email}</span>}
        </div>
      </div>

      <fieldset>
        <legend className="tf-label">CC người liên quan ({cc.size})</legend>
        {chosen.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {chosen.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => setCc((current) => {
                  const next = new Set(current);
                  next.delete(person.id);
                  return next;
                })}
                className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100"
                aria-label={`Bỏ ${person.name} khỏi CC`}
              >
                {person.name}
                <X size={12} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        <label className="relative block">
          <span className="sr-only">Tìm người để CC</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm theo tên hoặc email"
            className="tf-field !pl-9"
          />
        </label>
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-[7px] border border-zinc-200">
          {visible.map((person) => (
            <li key={person.id} className="border-b border-zinc-100 last:border-b-0">
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-zinc-50">
                <input
                  type="checkbox"
                  checked={cc.has(person.id)}
                  onChange={(event) => setCc((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(person.id);
                    else next.delete(person.id);
                    return next;
                  })}
                  className="h-4 w-4"
                />
                <Avatar id={person.id} name={person.name} avatarUrl={person.avatarUrl} className="h-6 w-6 text-[11px]" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{person.name}</span>
                  <span className="block truncate text-xs text-zinc-500">{person.email} · {person.roleLabel}</span>
                </span>
              </label>
            </li>
          ))}
          {visible.length === 0 && <li className="px-3 py-3 text-sm text-zinc-500">Không tìm thấy ai.</li>}
        </ul>
      </fieldset>

      <label className="block">
        <span className="tf-label">Lời nhắn (không bắt buộc)</span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="VD: Anh xem giúp em trước thứ 6"
          className="tf-field resize-none"
        />
      </label>

      {hidesSell && (
        <p className="rounded-[8px] bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Có người nhận không được xem số liệu bán, nên email sẽ không ghi giá bán, lợi nhuận, margin (chỉ ghi giá vốn).
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="tf-button-secondary">Huỷ</button>
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={() => onSubmit([...cc], message)}
          className="tf-button-primary"
        >
          {pending ? <span className="tf-spinner" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
          Gửi duyệt
        </button>
      </div>
    </Overlay>
  );
}

function RejectDialog({
  pending,
  onClose,
  onReject,
}: {
  pending: boolean;
  onClose: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Overlay onClose={onClose} labelledBy="reject-ic-title">
      <h2 id="reject-ic-title" className="text-lg font-semibold">Từ chối IC</h2>
      <label className="block">
        <span className="tf-label">Lý do (bắt buộc, người gửi và người được CC sẽ thấy)</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={4}
          maxLength={1000}
          autoFocus
          className="tf-field resize-none"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="tf-button-secondary">Huỷ</button>
        <button
          type="button"
          disabled={pending || !reason.trim()}
          onClick={() => onReject(reason)}
          className="tf-button-primary"
        >
          {pending && <span className="tf-spinner" aria-hidden="true" />}
          Từ chối IC
        </button>
      </div>
    </Overlay>
  );
}
