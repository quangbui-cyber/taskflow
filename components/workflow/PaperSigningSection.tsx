"use client";

import { useActionState } from "react";
import Link from "next/link";
import { workflowAction, type WorkflowActionState } from "@/app/actions/workflow";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel } from "@/components/ui/Presentation";

type Batch = {
  id: string;
  version: number;
  status: string;
  keeperDeclared: string;
  locationDeclared: string;
  keeperNormalized: string | null;
  locationNormalized: string | null;
  returnedReason: string | null;
  createdAt: string;
  files: { id: string; name: string; size: number; sha256: string }[];
  transitions: { id: string; action: string; reason: string; createdAt: string }[];
};

const BATCH_STATUS_LABELS: Record<string, string> = {
  CHO_KY: "Chờ ký giấy",
  PENDING: "Chờ xác nhận bản ký",
  RETURNED: "Yêu cầu tải lại bản ký",
  CONFIRMED: "Đã xác nhận lưu trữ",
};

const BATCH_STATUS_TONES: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  CHO_KY: "neutral",
  PENDING: "warning",
  RETURNED: "danger",
  CONFIRMED: "success",
};

function PaperForm({
  command,
  requestId,
  version,
  children,
  label,
  confirmMessage,
  variant,
}: {
  command: string;
  requestId: string;
  version: number;
  children?: React.ReactNode;
  label: string;
  confirmMessage?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const [state, action, pending] = useActionState(workflowAction, {} as WorkflowActionState);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
      className="space-y-3"
    >
      <input type="hidden" name="command" value={command} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="version" value={version} />
      {children}
      {state.error && <Alert tone="danger" title={state.error} />}
      {state.success && <Alert tone="success" title={state.success} />}
      <Button type="submit" variant={variant ?? "primary"} loading={pending}>
        {label}
      </Button>
    </form>
  );
}

export default function PaperSigningSection({
  requestId,
  version,
  creator,
  manager,
  batches,
}: {
  requestId: string;
  version: number;
  creator: boolean;
  manager: boolean;
  batches: Batch[];
}) {
  const active = batches.find((batch) =>
    ["PENDING", "RETURNED", "CONFIRMED"].includes(batch.status)
  );
  const activeStatus = active?.status ?? "CHO_KY";

  return (
    <Panel>
      <div className="tf-section-heading">
        <div>
          <h2>Bản ký & Lưu trữ gốc</h2>
          <p>
            Hồ sơ quét bản ký giấy vật lý; phê duyệt hồ sơ được bảo toàn độc lập với quá trình lưu trữ bản gốc.
          </p>
        </div>
        <Badge tone={BATCH_STATUS_TONES[activeStatus] ?? "neutral"}>
          {BATCH_STATUS_LABELS[activeStatus] ?? activeStatus}
        </Badge>
      </div>

      {creator && (!active || active.status === "RETURNED") && (
        <PaperForm
          command="UPLOAD_SIGNED"
          requestId={requestId}
          version={version}
          label={active ? "Tải lại bản scan đã ký" : "Tải lên bản scan đã ký"}
        >
          <Input
            type="file"
            name="signedDocuments"
            label="Bản scan PDF/JPG/PNG"
            accept="application/pdf,image/jpeg,image/png"
            multiple
            required
            hint="Tối đa 10 file, 4 MiB/file và 20 MiB/batch."
          />
          <Input
            name="keeper"
            label="Người giữ bản gốc (người lập khai báo)"
            required
          />
          <Input
            name="location"
            label="Nơi lưu bản gốc (người lập khai báo)"
            required
          />
        </PaperForm>
      )}

      {manager && active?.status === "PENDING" && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <PaperForm
            command="RETURN_SIGNED"
            requestId={requestId}
            version={version}
            label="Trả lại bản scan đã ký"
            variant="secondary"
            confirmMessage="Xác nhận trả lại bản scan đã ký cho người lập? Vui lòng nhập rõ lý do bản ký không đạt (mờ, thiếu chữ ký hoặc sai trang)."
          >
            <Textarea name="reason" label="Lý do trả" required />
          </PaperForm>
          <PaperForm
            command="CONFIRM_SIGNED"
            requestId={requestId}
            version={version}
            label="Xác nhận lưu trữ bản gốc"
            confirmMessage="Xác nhận bạn đã kiểm tra đầy đủ bản ký giấy và thông tin lưu trữ bản gốc?"
          >
            <input type="hidden" name="signatureConfirmed" value="yes" />
            <Input
              name="keeperNormalized"
              label="Người giữ bản gốc chuẩn hóa"
              defaultValue={active.keeperDeclared}
              required
            />
            <Input
              name="locationNormalized"
              label="Nơi lưu chuẩn hóa"
              defaultValue={active.locationDeclared}
              required
            />
          </PaperForm>
        </div>
      )}

      {batches.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="Chưa có bản scan ký giấy nào được tải lên"
            description="Người lập cần in phiếu đề nghị, lấy chữ ký sống và tải tệp PDF hoặc ảnh chụp bản ký lên hệ thống."
          />
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {batches.map((batch) => (
            <details key={batch.id} className="rounded border border-zinc-200 p-3">
              <summary className="cursor-pointer font-medium">
                Đợt scan {batch.version} · {BATCH_STATUS_LABELS[batch.status] ?? batch.status} ·{" "}
                {new Date(batch.createdAt).toLocaleString("vi-VN")}
              </summary>
              <div className="mt-3 text-sm">
                <p>Người giữ: {batch.keeperNormalized ?? batch.keeperDeclared}</p>
                <p>Nơi lưu: {batch.locationNormalized ?? batch.locationDeclared}</p>
                {batch.returnedReason && <p>Lý do trả: {batch.returnedReason}</p>}
                <ul className="mt-2">
                  {batch.files.map((file) => (
                    <li key={file.id}>
                      <Link
                        className="tf-link"
                        href={`/api/workflow/physical-scans/${file.id}`}
                      >
                        {file.name}
                      </Link>{" "}
                      · {Math.ceil(file.size / 1024)} KiB ·{" "}
                      <code>{file.sha256.slice(0, 12)}…</code>
                    </li>
                  ))}
                </ul>
                <ol className="mt-2 text-xs text-zinc-500">
                  {batch.transitions.map((item) => (
                    <li key={item.id}>
                      {item.action} ·{" "}
                      {new Date(item.createdAt).toLocaleString("vi-VN")}
                      {item.reason ? ` · ${item.reason}` : ""}
                    </li>
                  ))}
                </ol>
              </div>
            </details>
          ))}
        </div>
      )}
    </Panel>
  );
}
