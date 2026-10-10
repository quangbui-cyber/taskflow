/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useRef, useState, useId } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import {
  RotateCcw,
  PenTool,
  CheckCircle2,
  Upload,
  Sparkles,
  Image as ImageIcon,
  KeyRound,
  Eye,
  EyeOff,
} from "lucide-react";

export type SignaturePadProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (signatureDataUrl: string, pin: string) => void;
  title?: string;
  userProfileSignature?: string | null;
  userName?: string;
  userRoleTitle?: string;
  loading?: boolean;
  requirePin?: boolean;
};

type Point = { x: number; y: number };

export function SignaturePad({
  open,
  onClose,
  onConfirm,
  title = "Ký xác nhận hồ sơ điện tử",
  userProfileSignature = null,
  userName,
  userRoleTitle,
  loading = false,
  requirePin = true,
}: SignaturePadProps) {
  const [activeTab, setActiveTab] = useState<"draw" | "saved" | "upload">(
    userProfileSignature ? "saved" : "draw"
  );
  const [hasDrawn, setHasDrawn] = useState(false);
  const [savedSelected, setSavedSelected] = useState(Boolean(userProfileSignature));
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [agreedLegal, setAgreedLegal] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const strokePointsRef = useRef<Point[]>([]);

  const legalCheckboxId = useId();
  const pinInputId = useId();

  function initCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 460;
    const height = 180;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    setHasDrawn(false);
  }

  // Reset or setup canvas when opened or tab changed to draw
  useEffect(() => {
    if (!open) {
      if (canvasRef.current) {
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
      }
      setHasDrawn(false);
      setAgreedLegal(false);
      setUploadedDataUrl(null);
      setUploadError(null);
      setPin("");
      setShowPin(false);
      return;
    }

    if (activeTab === "draw") {
      const timer = setTimeout(() => {
        initCanvas();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open, activeTab]);

  function clearCanvas() {
    initCanvas();
    setHasDrawn(false);
  }

  function getCoordinates(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);

    const pt = getCoordinates(e);
    isDrawingRef.current = true;
    lastPointRef.current = pt;
    strokePointsRef.current = [pt];

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const currentPt = getCoordinates(e);
    strokePointsRef.current.push(currentPt);

    const points = strokePointsRef.current;
    if (points.length >= 3) {
      const xc = (points[points.length - 2].x + points[points.length - 1].x) / 2;
      const yc = (points[points.length - 2].y + points[points.length - 1].y) / 2;
      ctx.quadraticCurveTo(points[points.length - 2].x, points[points.length - 2].y, xc, yc);
      ctx.stroke();
      setHasDrawn(true);
    } else if (lastPointRef.current) {
      ctx.lineTo(currentPt.x, currentPt.y);
      ctx.stroke();
      setHasDrawn(true);
    }
    lastPointRef.current = currentPt;
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    strokePointsRef.current = [];
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if capture already released
    }
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setUploadError("Vui lòng tải lên tệp ảnh hợp lệ (PNG, JPG, WEBP).");
      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      setUploadError("Kích thước tệp ảnh vượt quá giới hạn 4 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        // Create offscreen canvas for background removal (white thresholding)
        const offCanvas = document.createElement("canvas");
        const maxW = 480;
        const maxH = 200;
        let w = img.width;
        let h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        offCanvas.width = w;
        offCanvas.height = h;
        const offCtx = offCanvas.getContext("2d");
        if (!offCtx) return;

        offCtx.drawImage(img, 0, 0, w, h);
        const imgData = offCtx.getImageData(0, 0, w, h);
        const data = imgData.data;

        // Convert near-white background to transparent, darken ink strokes
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
          if (brightness > 210) {
            data[i + 3] = 0; // Transparent
          } else {
            // Normalize ink color to deep indigo-slate
            data[i] = Math.max(15, Math.min(r, 30));
            data[i + 1] = Math.max(23, Math.min(g, 45));
            data[i + 2] = Math.max(42, Math.min(b, 80));
          }
        }
        offCtx.putImageData(imgData, 0, 0);
        const processedUrl = offCanvas.toDataURL("image/png");
        setUploadedDataUrl(processedUrl);
      };
      img.src = evt.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  function handleConfirm() {
    if (!agreedLegal) return;
    if (requirePin && (!pin || pin.length !== 6 || !/^\d{6}$/.test(pin))) return;

    if (activeTab === "draw") {
      const canvas = canvasRef.current;
      if (!canvas || !hasDrawn) return;
      const dataUrl = canvas.toDataURL("image/png");
      onConfirm(dataUrl, pin);
    } else if (activeTab === "saved") {
      if (!userProfileSignature) return;
      onConfirm(userProfileSignature, pin);
    } else if (activeTab === "upload") {
      if (!uploadedDataUrl) return;
      onConfirm(uploadedDataUrl, pin);
    }
  }

  const isSignatureReady =
    (activeTab === "draw" && hasDrawn) ||
    (activeTab === "saved" && Boolean(userProfileSignature) && savedSelected) ||
    (activeTab === "upload" && Boolean(uploadedDataUrl));

  const isPinValid = !requirePin || (pin.length === 6 && /^\d{6}$/.test(pin));
  const canSubmit = isSignatureReady && agreedLegal && isPinValid && !loading;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={
        userName || userRoleTitle
          ? `Người ký: ${userName ?? "Thành viên"} · Vai trò: ${userRoleTitle ?? "Người duyệt"}`
          : "Ảnh chữ ký điện tử nội bộ sẽ được gắn vào đúng phiên bản hồ sơ sau khi xác thực PIN."
      }
      className="max-w-xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Đóng cửa sổ
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            loading={loading}
            loadingLabel="Đang ghi nhận chữ ký…"
            disabled={!canSubmit}
          >
            Xác nhận ký & Duyệt hồ sơ
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Segmented Control Tabs */}
        <div
          role="tablist"
          aria-label="Hình thức ký số"
          className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1 text-sm font-medium"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "draw"}
            onClick={() => setActiveTab("draw")}
            className={`flex items-center justify-center gap-1.5 rounded-md py-2 px-3 transition-colors ${
              activeTab === "draw"
                ? "bg-white text-zinc-900 shadow-sm font-semibold"
                : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            <PenTool size={16} aria-hidden="true" />
            <span>✍️ Vẽ tay</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "saved"}
            onClick={() => setActiveTab("saved")}
            className={`flex items-center justify-center gap-1.5 rounded-md py-2 px-3 transition-colors ${
              activeTab === "saved"
                ? "bg-white text-zinc-900 shadow-sm font-semibold"
                : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            <Sparkles size={16} aria-hidden="true" />
            <span>⚡ Chữ ký mẫu</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "upload"}
            onClick={() => setActiveTab("upload")}
            className={`flex items-center justify-center gap-1.5 rounded-md py-2 px-3 transition-colors ${
              activeTab === "upload"
                ? "bg-white text-zinc-900 shadow-sm font-semibold"
                : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            <Upload size={16} aria-hidden="true" />
            <span>📂 Tải ảnh</span>
          </button>
        </div>

        {/* Tab 1: Draw Canvas */}
        {activeTab === "draw" && (
          <div className="space-y-2">
            <div className="relative rounded-lg border border-zinc-300 bg-white shadow-inner overflow-hidden">
              <canvas
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className="h-[180px] w-full cursor-crosshair touch-none select-none bg-white block"
                style={{ touchAction: "none" }}
              />

              {/* Baseline dotted guide line */}
              <div
                className="pointer-events-none absolute left-6 right-6 bottom-9 border-b border-dashed border-zinc-200"
                aria-hidden="true"
              >
                <span className="absolute -top-4 right-0 text-[10px] uppercase tracking-wider text-zinc-300">
                  Đường ký tên
                </span>
              </div>

              {!hasDrawn && (
                <div
                  className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-zinc-400"
                  aria-hidden="true"
                >
                  Dùng chuột, bút cảm ứng hoặc ngón tay để vẽ chữ ký của bạn vào đây
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span className="flex items-center gap-1 text-emerald-600 font-medium">
                <CheckCircle2 size={13} aria-hidden="true" />
                Nét vẽ mượt (Smooth Calligraphy)
              </span>
              <button
                type="button"
                onClick={clearCanvas}
                disabled={!hasDrawn}
                className="inline-flex items-center gap-1 text-zinc-600 hover:text-zinc-900 disabled:opacity-40"
              >
                <RotateCcw size={13} aria-hidden="true" />
                <span>Xóa nét và ký lại</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Saved Profile Signature */}
        {activeTab === "saved" && (
          <div className="space-y-3">
            {userProfileSignature ? (
              <div
                onClick={() => setSavedSelected(true)}
                className={`relative cursor-pointer rounded-lg border-2 p-4 transition-all bg-white flex flex-col items-center justify-center ${
                  savedSelected
                    ? "border-brand-600 bg-brand-50/20 shadow-sm"
                    : "border-zinc-200 hover:border-zinc-300"
                }`}
              >
                <div className="absolute top-3 right-3">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                      savedSelected
                        ? "bg-brand-600 text-white font-bold"
                        : "border border-zinc-300 text-transparent"
                    }`}
                  >
                    ✓
                  </span>
                </div>

                <div className="flex h-[130px] w-full items-center justify-center p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={userProfileSignature}
                    alt="Chữ ký mẫu cá nhân"
                    className="max-h-[110px] max-w-[85%] object-contain filter drop-shadow-sm"
                  />
                </div>

                <p className="mt-1 text-xs text-zinc-500">
                  Chữ ký mẫu mặc định đã lưu trong tài khoản của bạn.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center bg-zinc-50">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200 text-zinc-500 mb-2">
                  <PenTool size={18} aria-hidden="true" />
                </div>
                <h4 className="text-sm font-semibold text-zinc-800">
                  Chưa có chữ ký mẫu trong hồ sơ cá nhân
                </h4>
                <p className="mt-1 text-xs text-zinc-500 max-w-sm mx-auto">
                  Bạn có thể chuyển sang tab <strong>Vẽ tay</strong> để ký trực tiếp cho lần này,
                  hoặc thiết lập chữ ký mẫu trong trang Cá nhân để ký nhanh 1-chạm sau này.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => setActiveTab("draw")}
                >
                  Chuyển sang vẽ tay
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Upload Image */}
        {activeTab === "upload" && (
          <div className="space-y-3">
            {!uploadedDataUrl ? (
              <label className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50/70 p-6 text-center cursor-pointer hover:bg-zinc-100 transition-colors">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200 text-zinc-600 mb-2">
                  <ImageIcon size={20} aria-hidden="true" />
                </div>
                <span className="text-sm font-medium text-zinc-800">
                  Bấm để chọn ảnh chữ ký trên giấy
                </span>
                <span className="mt-1 text-xs text-zinc-500">
                  Ảnh nguồn được xử lý thành PNG trong suốt; server kiểm tra lại nội dung trước khi lưu
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleImageUpload}
                  className="sr-only"
                />
              </label>
            ) : (
              <div className="rounded-lg border border-zinc-300 p-4 bg-white space-y-2">
                <div className="flex h-[130px] w-full items-center justify-center bg-zinc-50 rounded border border-zinc-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={uploadedDataUrl}
                    alt="Ảnh chữ ký đã tải"
                    className="max-h-[110px] max-w-[85%] object-contain"
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 size={13} aria-hidden="true" />
                    Đã xử lý nền trong suốt
                  </span>
                  <label className="text-brand-600 hover:text-brand-700 cursor-pointer font-medium underline">
                    Chọn ảnh khác
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleImageUpload}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>
            )}

            {uploadError && (
              <p className="text-xs font-medium text-rose-600">{uploadError}</p>
            )}
          </div>
        )}

        {/* 6-Digit Security PIN */}
        {requirePin && (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor={pinInputId}
                className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5"
              >
                <KeyRound size={14} className="text-brand-600" aria-hidden="true" />
                <span>Mã PIN bảo mật ký số (6 chữ số)</span>
                <span className="text-rose-600">*</span>
              </label>
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="text-xs text-zinc-500 hover:text-zinc-800 flex items-center gap-1 cursor-pointer"
                aria-label={showPin ? "Ẩn mã PIN" : "Hiện mã PIN"}
              >
                {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                <span>{showPin ? "Ẩn" : "Hiện"}</span>
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <input
                  id={pinInputId}
                  type={showPin ? "text" : "password"}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setPin(val);
                  }}
                  placeholder="••••••"
                  className="w-full tracking-[0.5em] font-mono text-center text-lg font-bold py-2 px-3 rounded-lg border border-zinc-300 bg-white focus:border-brand-600 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
                  autoComplete="one-time-code"
                />
              </div>
              <div className="flex gap-1.5" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((idx) => (
                  <span
                    key={idx}
                    className={`h-2.5 w-2.5 rounded-full transition-colors ${
                      idx < pin.length ? "bg-brand-600" : "bg-zinc-200"
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-zinc-500">
              <span>Nhập mã PIN đã thiết lập trong hồ sơ cá nhân</span>
              <span className="font-mono text-zinc-400">Gợi ý thử nghiệm: 123456</span>
            </div>
          </div>
        )}

        {/* Legal Commitment Checkbox */}
        <div className="pt-1">
          <label
            htmlFor={legalCheckboxId}
            className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 cursor-pointer select-none transition-colors hover:bg-amber-50"
          >
            <input
              id={legalCheckboxId}
              type="checkbox"
              checked={agreedLegal}
              onChange={(e) => setAgreedLegal(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-amber-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="leading-relaxed">
              <strong>Cam kết trách nhiệm:</strong> Tôi xác nhận nội dung hồ sơ hợp lệ và đồng ý
              phê duyệt / ký nhận tài liệu này theo thẩm quyền được giao. Chữ ký số sẽ được bảo vệ
              bất biến bằng mã băm SHA-256.
            </span>
          </label>
        </div>
      </div>
    </Dialog>
  );
}
