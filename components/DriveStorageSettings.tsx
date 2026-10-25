"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, CloudUpload, HardDrive, Link2Off, TriangleAlert } from "lucide-react";
import { useInteraction } from "@/components/InteractionProvider";
import { disconnectGoogleDrive, migrateFilesToDrive } from "@/app/actions/googleDrive";

type Connection = {
  email: string;
  connectedAt: string;
  lastError: string | null;
  lastErrorAt: string | null;
};

const RESULT_MESSAGES: Record<string, { tone: "success" | "error"; text: string }> = {
  connected: { tone: "success", text: "Đã kết nối Google Drive." },
  denied: { tone: "error", text: "Google chưa cho quyền Drive. Hãy bấm kết nối lại và tick quyền Google Drive." },
  mismatch: { tone: "error", text: "Sai tài khoản Google. Hãy chọn đúng tài khoản kho lưu trữ." },
  "no-drive": { tone: "error", text: "Đã kết nối nhưng tài khoản chưa vào được Shared Drive." },
  failed: { tone: "error", text: "Kết nối không thành công. Thử lại sau ít phút." },
  unavailable: { tone: "error", text: "Đăng nhập Google chưa được cấu hình cho app." },
};

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export default function DriveStorageSettings({
  configured,
  connection,
  counts,
  result,
}: {
  configured: boolean;
  connection: Connection | null;
  counts: { pending: number; onDrive: number };
  result?: string;
}) {
  const { notify } = useInteraction();
  const [pending, setPending] = useState(counts.pending);
  const [onDrive, setOnDrive] = useState(counts.onDrive);
  const [migrating, setMigrating] = useState(false);
  const [isDisconnecting, startDisconnect] = useTransition();
  const banner = result ? RESULT_MESSAGES[result] : undefined;

  async function migrate() {
    setMigrating(true);
    try {
      // Mỗi lượt chuyển một đợt nhỏ để không quá thời gian chạy của máy chủ.
      for (let round = 0; round < 200; round += 1) {
        const step = await migrateFilesToDrive();
        setPending(step.pending);
        setOnDrive(step.onDrive);
        if (step.error) throw new Error(step.error);
        if (step.pending === 0) {
          notify({ message: "Đã chuyển hết file cũ lên Google Drive.", tone: "success" });
          return;
        }
        if (step.pushed === 0) {
          throw new Error(`Còn ${step.pending} file chưa chuyển được. Xem lỗi gần nhất bên dưới rồi thử lại.`);
        }
      }
    } catch (error) {
      notify({ message: error instanceof Error ? error.message : "Không chuyển được file.", tone: "error" });
    } finally {
      setMigrating(false);
    }
  }

  function disconnect() {
    if (!window.confirm("Ngắt kết nối Google Drive? File mới sẽ lưu trong app (tối đa 4 MB) cho tới khi kết nối lại.")) return;
    startDisconnect(async () => {
      const state = await disconnectGoogleDrive();
      notify({ message: state.error ?? state.success ?? "", tone: state.error ? "error" : "success" });
    });
  }

  return (
    <section id="google-drive" className="tf-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-zinc-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
            <HardDrive size={19} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold text-zinc-950">Lưu trữ Google Drive</h2>
          </div>
        </div>
        {connection ? (
          <button type="button" className="tf-button-secondary shrink-0" onClick={disconnect} disabled={isDisconnecting}>
            <Link2Off size={16} aria-hidden="true" />
            Ngắt kết nối
          </button>
        ) : configured ? (
          <a href="/api/google/gmail/drive-connect" className="tf-button-primary shrink-0">
            Kết nối Google Drive
          </a>
        ) : null}
      </div>

      <div className="space-y-4 px-5 py-4 text-sm">
        {banner && (
          <p
            className={`rounded-[8px] px-3 py-2 ${
              banner.tone === "success" ? "bg-brand-50 text-brand-800" : "bg-red-50 text-red-700"
            }`}
            role="status"
          >
            {banner.text}
          </p>
        )}

        {connection ? (
          <div className="flex items-start gap-2 text-zinc-700">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
            <p>
              Đang dùng <strong>{connection.email}</strong>, kết nối lúc {dateTime(connection.connectedAt)}.
            </p>
          </div>
        ) : (
          <div className="space-y-1 text-zinc-600">
            <p>
              {configured
                ? "Chưa kết nối. File mới đang lưu trong app (tối đa 4 MB)."
                : "Đăng nhập Google chưa được cấu hình nên chưa kết nối được Drive."}
            </p>
          </div>
        )}

        {connection?.lastError && (
          <div className="flex items-start gap-2 rounded-[8px] bg-amber-50 px-3 py-2 text-amber-900">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              {connection.lastError}
              {connection.lastErrorAt && <span className="text-amber-700"> · {dateTime(connection.lastErrorAt)}</span>}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
          <div className="rounded-[8px] bg-zinc-50 px-3 py-2.5">
            <p className="text-xs text-zinc-500">Đã lên Drive</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-zinc-900">{onDrive}</p>
          </div>
          <div className="rounded-[8px] bg-zinc-50 px-3 py-2.5">
            <p className="text-xs text-zinc-500">Còn trong app</p>
            <p className={`mt-0.5 text-xl font-semibold tabular-nums ${pending > 0 ? "text-amber-600" : "text-zinc-400"}`}>
              {pending}
            </p>
          </div>
        </div>

        {connection && pending > 0 && (
          <div className="space-y-2">
            <button type="button" className="tf-button-primary" onClick={() => void migrate()} disabled={migrating} aria-busy={migrating}>
              {migrating ? <span className="tf-spinner" aria-hidden="true" /> : <CloudUpload size={16} aria-hidden="true" />}
              {migrating ? `Đang chuyển… còn ${pending} file` : `Chuyển ${pending} file cũ lên Drive`}
            </button>
          </div>
        )}

      </div>
    </section>
  );
}
