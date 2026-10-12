"use client";

import { useRef, useState, useEffect } from "react";
import {
  PenTool,
  Upload,
  RotateCcw,
  CheckCircle2,
  Trash2,
  Sparkles,
  Image as ImageIcon,
  KeyRound,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert, Badge } from "@/components/ui/Presentation";
import {
  deleteOwnSignature,
  saveOwnSignature,
  updateSignaturePin,
} from "@/app/actions/profile";

export type ProfileSignatureFormProps = {
  initialSignatureData?: string | null;
  initialHasPin?: boolean;
};

type Point = { x: number; y: number };

export function ProfileSignatureForm({
  initialSignatureData = null,
  initialHasPin = false,
}: ProfileSignatureFormProps) {
  const [mainTab, setMainTab] = useState<"signature" | "pin">("signature");
  const [signatureUrl, setSignatureUrl] = useState<string | null>(initialSignatureData);
  const [isEditing, setIsEditing] = useState(!initialSignatureData);
  const [mode, setMode] = useState<"draw" | "upload">("draw");
  const [hasDrawn, setHasDrawn] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; message: string } | null>(null);

  // PIN management state
  const [hasPin, setHasPin] = useState(initialHasPin);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinPending, setPinPending] = useState(false);
  const [pinFeedback, setPinFeedback] = useState<{ tone: "success" | "danger"; message: string } | null>(null);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const strokePointsRef = useRef<Point[]>([]);

  useEffect(() => {
    if (isEditing && mode === "draw") {
      const timer = setTimeout(() => {
        initCanvas();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isEditing, mode]);

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
      // Ignored
    }
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setFeedback({ tone: "danger", message: "Vui lòng chọn tệp hình ảnh hợp lệ." });
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
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

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
          if (brightness > 210) {
            data[i + 3] = 0;
          } else {
            data[i] = 15;
            data[i + 1] = 23;
            data[i + 2] = 42;
          }
        }
        offCtx.putImageData(imgData, 0, 0);
        setUploadedUrl(offCanvas.toDataURL("image/png"));
      };
      img.src = evt.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    let finalDataUrl: string | null = null;
    if (mode === "draw") {
      const canvas = canvasRef.current;
      if (!canvas || !hasDrawn) return;
      finalDataUrl = canvas.toDataURL("image/png");
    } else {
      finalDataUrl = uploadedUrl;
    }

    if (!finalDataUrl) return;

    setPending(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.set("signatureData", finalDataUrl);
      const res = await saveOwnSignature(formData);
      if (res.error) {
        setFeedback({ tone: "danger", message: res.error });
        return;
      }
      setSignatureUrl(finalDataUrl);
      setIsEditing(false);
      setFeedback({ tone: "success", message: "Đã lưu chữ ký mẫu cá nhân thành công!" });
    } catch (err: unknown) {
      setFeedback({
        tone: "danger",
        message: err instanceof Error ? err.message : "Không thể lưu chữ ký.",
      });
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    setPending(true);
    setFeedback(null);
    try {
      const res = await deleteOwnSignature();
      if (res.error) {
        setFeedback({ tone: "danger", message: res.error });
        return;
      }
      setSignatureUrl(null);
      setIsEditing(true);
      setFeedback({ tone: "success", message: "Đã xóa chữ ký mẫu." });
    } catch (err: unknown) {
      setFeedback({
        tone: "danger",
        message: err instanceof Error ? err.message : "Lỗi khi xóa chữ ký.",
      });
    } finally {
      setPending(false);
    }
  }

  async function handleSavePin() {
    setPinFeedback(null);
    if (hasPin && !currentPassword.trim()) {
      setPinFeedback({ tone: "danger", message: "Vui lòng nhập mật khẩu tài khoản hiện tại để xác thực." });
      return;
    }
    if (newPin.length !== 6 || !/^\d{6}$/.test(newPin)) {
      setPinFeedback({ tone: "danger", message: "Mã PIN mới phải gồm đúng 6 chữ số." });
      return;
    }
    if (newPin !== confirmPin) {
      setPinFeedback({ tone: "danger", message: "Mã PIN xác nhận không khớp với mã PIN mới." });
      return;
    }

    setPinPending(true);
    try {
      const formData = new FormData();
      formData.set("currentPassword", currentPassword);
      formData.set("newPin", newPin);
      formData.set("confirmPin", confirmPin);
      const res = await updateSignaturePin(formData);
      if (res.error) {
        setPinFeedback({ tone: "danger", message: res.error });
        return;
      }
      setHasPin(true);
      setCurrentPassword("");
      setNewPin("");
      setConfirmPin("");
      setPinFeedback({ tone: "success", message: "Đã cập nhật mã PIN bảo mật 6 số thành công!" });
    } catch (err: unknown) {
      setPinFeedback({
        tone: "danger",
        message: err instanceof Error ? err.message : "Lỗi khi lưu mã PIN.",
      });
    } finally {
      setPinPending(false);
    }
  }

  return (
    <section className="tf-panel overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-zinc-900 flex items-center gap-2">
            <Sparkles size={16} className="text-brand-600" aria-hidden="true" />
            Bảo mật chữ ký số & Mã PIN
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Quản lý chữ ký mẫu và mã PIN xác thực 6 số khi nộp đơn hoặc phê duyệt chứng từ.
          </p>
        </div>

        {/* Tab Switcher */}
        <div
          role="tablist"
          aria-label="Cài đặt ký số"
          className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-xs font-medium"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mainTab === "signature"}
            onClick={() => setMainTab("signature")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
              mainTab === "signature"
                ? "bg-white text-zinc-900 font-semibold shadow-sm"
                : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            <PenTool size={13} aria-hidden="true" />
            <span>Chữ ký mẫu</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mainTab === "pin"}
            onClick={() => setMainTab("pin")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
              mainTab === "pin"
                ? "bg-white text-zinc-900 font-semibold shadow-sm"
                : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            <KeyRound size={13} aria-hidden="true" />
            <span>Mã PIN 6 số</span>
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* MAIN TAB 1: CHỮ KÝ MẪU */}
        {mainTab === "signature" && (
          <div className="space-y-4">
            {feedback && <Alert tone={feedback.tone} title={feedback.message} />}

            {!isEditing && signatureUrl ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4 flex flex-col items-center justify-center">
                  <div className="flex h-[140px] w-full max-w-md items-center justify-center rounded bg-white border border-zinc-200 shadow-inner p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={signatureUrl}
                      alt="Chữ ký mẫu của bạn"
                      className="max-h-[120px] max-w-full object-contain filter drop-shadow-sm"
                    />
                  </div>
                  <p className="mt-2 text-xs text-zinc-500 flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-emerald-600" aria-hidden="true" />
                    Chữ ký mẫu đang hoạt động · Tự động điền khi ký duyệt
                  </p>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button
                    variant="ghost"
                    onClick={handleDelete}
                    loading={pending}
                    className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    Xóa chữ ký
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setIsEditing(true);
                      setUploadedUrl(null);
                      setHasDrawn(false);
                    }}
                  >
                    <PenTool size={15} aria-hidden="true" />
                    Thay đổi chữ ký
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Toggle draw / upload */}
                <div className="flex gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setMode("draw")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium text-xs transition-colors ${
                      mode === "draw"
                        ? "bg-zinc-900 text-white"
                        : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                    }`}
                  >
                    <PenTool size={14} aria-hidden="true" />
                    Vẽ trực tiếp
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("upload")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium text-xs transition-colors ${
                      mode === "upload"
                        ? "bg-zinc-900 text-white"
                        : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                    }`}
                  >
                    <Upload size={14} aria-hidden="true" />
                    Tải ảnh chữ ký
                  </button>
                </div>

                {mode === "draw" ? (
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
                      <div
                        className="pointer-events-none absolute left-6 right-6 bottom-9 border-b border-dashed border-zinc-200"
                        aria-hidden="true"
                      >
                        <span className="absolute -top-4 right-0 text-xs uppercase tracking-wider text-zinc-300">
                          Đường ký mẫu
                        </span>
                      </div>
                      {!hasDrawn && (
                        <div
                          className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-zinc-400"
                          aria-hidden="true"
                        >
                          Dùng chuột hoặc màn hình cảm ứng để vẽ chữ ký của bạn
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span className="text-zinc-500">Nét vẽ tự động tối ưu độ mịn</span>
                      <button
                        type="button"
                        onClick={initCanvas}
                        disabled={!hasDrawn}
                        className="inline-flex items-center gap-1 text-zinc-600 hover:text-zinc-900 disabled:opacity-40"
                      >
                        <RotateCcw size={13} aria-hidden="true" />
                        Xóa nét và ký lại
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {!uploadedUrl ? (
                      <label className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50/70 p-6 text-center cursor-pointer hover:bg-zinc-100 transition-colors">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200 text-zinc-600 mb-2">
                          <ImageIcon size={20} aria-hidden="true" />
                        </div>
                        <span className="text-sm font-medium text-zinc-800">
                          Bấm để chọn tệp ảnh chữ ký trên giấy
                        </span>
                        <span className="mt-1 text-xs text-zinc-500">
                          Hệ thống tự động lọc nền trắng thành trong suốt (PNG, JPG dưới 4 MB)
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
                            src={uploadedUrl}
                            alt="Chữ ký đã chọn"
                            className="max-h-[110px] max-w-[85%] object-contain"
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-emerald-600 font-medium flex items-center gap-1">
                            <CheckCircle2 size={13} aria-hidden="true" />
                            Đã lọc nền trong suốt
                          </span>
                          <label className="text-brand-600 hover:text-brand-700 cursor-pointer font-medium underline">
                            Chọn tệp khác
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
                  </div>
                )}

                <div className="flex items-center justify-between border-t border-zinc-100 pt-4">
                  {signatureUrl ? (
                    <Button
                      variant="ghost"
                      onClick={() => setIsEditing(false)}
                      disabled={pending}
                    >
                      Hủy thao tác
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button
                    variant="primary"
                    onClick={handleSave}
                    loading={pending}
                    loadingLabel="Đang lưu chữ ký…"
                    disabled={mode === "draw" ? !hasDrawn : !uploadedUrl}
                  >
                    Lưu chữ ký mẫu vào hồ sơ
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MAIN TAB 2: MÃ PIN BẢO MẬT 6 SỐ */}
        {mainTab === "pin" && (
          <div className="space-y-4">
            {pinFeedback && <Alert tone={pinFeedback.tone} title={pinFeedback.message} />}

            {/* Status Card */}
            <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Trạng thái bảo mật mã PIN
                </span>
                <Badge tone={hasPin ? "success" : "warning"}>
                  {hasPin ? "Đã kích hoạt" : "Chưa kích hoạt"}
                </Badge>
              </div>
              <p className="text-xs text-zinc-600 leading-relaxed">
                Mã PIN bảo mật 6 số được yêu cầu mỗi khi bạn ký số hoặc duyệt hồ sơ trên hệ thống.
                Mã này được mã hóa bảo mật một chiều bằng thuật toán bcrypt.
              </p>
            </div>

            {/* Form Thiết lập / Đổi PIN */}
            <div className="space-y-3 pt-1">
              {hasPin && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="tf-label">
                      Mật khẩu tài khoản hiện tại <span>(bắt buộc để đổi PIN)</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="text-xs text-zinc-500 hover:text-zinc-800 flex items-center gap-1 cursor-pointer"
                    >
                      {showCurrentPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                      <span>{showCurrentPassword ? "Ẩn" : "Hiện"}</span>
                    </button>
                  </div>
                  <input
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Nhập mật khẩu đăng nhập để xác thực chính chủ"
                    className="tf-field"
                    required
                  />
                  <p className="tf-ui-help">
                    Xác thực mật khẩu nhằm chống hành vi chiếm dụng phiên đổi mã PIN trái phép.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="tf-label">
                      Mã PIN mới (6 chữ số) <span>(bắt buộc)</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowNewPin(!showNewPin)}
                      className="text-xs text-zinc-500 hover:text-zinc-800 flex items-center gap-1 cursor-pointer"
                    >
                      {showNewPin ? <EyeOff size={13} /> : <Eye size={13} />}
                      <span>{showNewPin ? "Ẩn" : "Hiện"}</span>
                    </button>
                  </div>
                  <input
                    type={showNewPin ? "text" : "password"}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="6 chữ số, ví dụ 123456"
                    className="tf-field font-mono font-bold tracking-widest text-center"
                    required
                  />
                  <div className="flex justify-center gap-1.5 pt-1" aria-hidden="true">
                    {[0, 1, 2, 3, 4, 5].map((idx) => (
                      <span
                        key={idx}
                        className={`h-2 w-2 rounded-full transition-colors ${
                          idx < newPin.length ? "bg-brand-600" : "bg-zinc-200"
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="tf-label">
                    Xác nhận mã PIN mới <span>(bắt buộc)</span>
                  </label>
                  <input
                    type={showNewPin ? "text" : "password"}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="Nhập lại 6 chữ số"
                    className="tf-field font-mono font-bold tracking-widest text-center"
                    required
                  />
                  <p className="tf-ui-help text-center">
                    {confirmPin && confirmPin === newPin && (
                      <span className="text-emerald-600 font-medium">✓ Mã PIN khớp</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end border-t border-zinc-100 pt-4">
                <Button
                  variant="primary"
                  onClick={handleSavePin}
                  loading={pinPending}
                  loadingLabel="Đang lưu mã PIN…"
                  disabled={
                    newPin.length !== 6 ||
                    confirmPin.length !== 6 ||
                    newPin !== confirmPin ||
                    (hasPin && !currentPassword.trim())
                  }
                >
                  <ShieldCheck size={14} className="mr-1.5" />
                  {hasPin ? "Cập nhật mã PIN bảo mật" : "Thiết lập mã PIN 6 số"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
