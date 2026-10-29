"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Laptop, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useInteraction } from "@/components/InteractionProvider";

type TokenItem = {
  id: string;
  label: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export default function ExtensionTokensCard({
  initialTokens,
}: {
  initialTokens: TokenItem[];
}) {
  const { notify } = useInteraction();
  const [tokens, setTokens] = useState<TokenItem[]>(initialTokens);
  const [pending, startTransition] = useTransition();
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  function formatDate(iso: string | null) {
    if (!iso) return "Chưa sử dụng";
    const d = new Date(iso);
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  }

  async function handleCreateToken(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const response = await fetch("/api/ext/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: newLabel.trim() || undefined }),
        });
        const data = (await response.json()) as {
          success?: boolean;
          token?: string;
          id?: string;
          label?: string;
          error?: string;
        };

        if (!response.ok || !data.token) {
          throw new Error(data.error || "Không thể tạo token kết nối.");
        }

        setCreatedToken(data.token);
        setTokens((prev) => [
          {
            id: data.id!,
            label: data.label!,
            lastUsedAt: null,
            revokedAt: null,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        setNewLabel("");
        setShowCreateForm(false);
        notify({ message: "Đã tạo token kết nối Extension thành công.", tone: "success" });
      } catch (error) {
        notify({
          message: error instanceof Error ? error.message : "Lỗi khi tạo token",
          tone: "error",
        });
      }
    });
  }

  async function handleRevoke(tokenId: string) {
    if (!window.confirm("Bạn có chắc chắn muốn ngắt kết nối thiết bị này?")) return;
    startTransition(async () => {
      try {
        const response = await fetch("/api/ext/tokens", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: tokenId }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Không thể thu hồi token.");
        }
        setTokens((prev) =>
          prev.map((t) => (t.id === tokenId ? { ...t, revokedAt: new Date().toISOString() } : t))
        );
        notify({ message: "Đã ngắt kết nối thiết bị.", tone: "success" });
      } catch (error) {
        notify({
          message: error instanceof Error ? error.message : "Lỗi khi thu hồi token",
          tone: "error",
        });
      }
    });
  }

  function handleCopy() {
    if (!createdToken) return;
    navigator.clipboard.writeText(createdToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const activeTokens = tokens.filter((t) => !t.revokedAt);

  return (
    <section className="tf-panel space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 flex items-center gap-2">
            <Laptop size={18} className="text-brand-600" aria-hidden="true" />
            Chrome Extension ghi biên bản
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Kết nối Extension myCreative Recorder để ghi biên bản 1 click trên Google Meet.
          </p>
        </div>
        {!showCreateForm && (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="tf-button-secondary text-xs !py-1.5"
          >
            <Plus size={15} aria-hidden="true" />
            Kết nối máy mới
          </button>
        )}
      </div>

      {/* Thông báo token vừa tạo (chỉ hiện một lần) */}
      {createdToken && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
              <ShieldCheck size={16} /> Token kết nối đã sẵn sàng
            </span>
            <button
              type="button"
              onClick={() => setCreatedToken(null)}
              className="text-emerald-700 hover:text-emerald-900"
              title="Đóng"
            >
              <X size={15} />
            </button>
          </div>
          <p className="text-xs text-emerald-700">
            Hãy sao chép mã này và dán vào mục <strong>Cài đặt (Options)</strong> của Extension trên trình duyệt. Token này chỉ hiển thị một lần duy nhất.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              readOnly
              value={createdToken}
              className="tf-field font-mono text-xs flex-1 !min-h-9 !py-1 bg-white select-all"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="tf-button-primary text-xs !min-h-9 px-3 shrink-0"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Đã chép" : "Sao chép"}
            </button>
          </div>
        </div>
      )}

      {/* Form tạo token mới */}
      {showCreateForm && (
        <form onSubmit={handleCreateToken} className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-4 space-y-3">
          <h3 className="text-xs font-medium text-zinc-700">Tạo kết nối cho thiết bị mới</h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              autoFocus
              type="text"
              placeholder="Tên thiết bị (ví dụ: MacBook cá nhân, Chrome Cty...)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="tf-field text-xs !min-h-9 !py-1"
              maxLength={100}
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pending}
                className="tf-button-primary text-xs !min-h-9 px-3"
              >
                {pending ? <span className="tf-spinner" /> : "Tạo mã kết nối"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  setNewLabel("");
                }}
                className="tf-button-secondary text-xs !min-h-9 px-3"
              >
                Huỷ
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Danh sách thiết bị đã kết nối */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          Thiết bị đang kết nối ({activeTokens.length})
        </h3>
        {activeTokens.length === 0 ? (
          <p className="text-xs text-zinc-400 py-3">Chưa có thiết bị hoặc extension nào được kết nối.</p>
        ) : (
          <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 overflow-hidden">
            {activeTokens.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-3 bg-white hover:bg-zinc-50 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-zinc-900 truncate">{item.label}</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Tạo: {formatDate(item.createdAt)} · Dùng gần nhất: {formatDate(item.lastUsedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => handleRevoke(item.id)}
                  className="tf-icon-button text-red-500 hover:text-red-700 hover:bg-red-50 ml-3"
                  title="Ngắt kết nối"
                  aria-label={`Ngắt kết nối ${item.label}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
