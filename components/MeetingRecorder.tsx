"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, Pause, Play, Square, Trash2, Upload } from "lucide-react";
import { useInteraction } from "@/components/InteractionProvider";
import { formatClock } from "@/lib/meetingRecap";
import {
  RECORDING_BITS_PER_SECOND,
  RECORDING_CHUNK_MS,
  microphoneErrorMessage,
  pickRecordingMimeType,
  recordingFileName,
  recordingFileType,
} from "@/lib/meetingRecorder";
import { formatLimit, friendlyUploadError, uploadRecapAudio } from "@/lib/recapUploadClient";
import {
  clearRecording,
  loadRecording,
  saveRecordingChunk,
  saveRecordingMeta,
  type RecordingMeta,
} from "@/lib/recordingStore";

type Phase = "loading" | "idle" | "requesting" | "recording" | "paused" | "stopped" | "uploading";

type SavedRecording = {
  blob: Blob;
  mimeType: string;
  startedAt: number;
  durationMs: number;
  recovered: boolean;
};

type WakeLockLike = { release: () => Promise<void> };

const MB = 1024 * 1024;

export default function MeetingRecorder({
  meetingId,
  maxAudioMinutes,
  onUploaded,
}: {
  meetingId: string;
  maxAudioMinutes: number;
  onUploaded: () => void;
}) {
  const { notify } = useInteraction();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [consent, setConsent] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [saved, setSaved] = useState<SavedRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const [progress, setProgress] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const seqRef = useRef(0);
  const metaRef = useRef<RecordingMeta | null>(null);
  const accumulatedRef = useRef(0);
  const runStartRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockLike | null>(null);
  const maxMs = maxAudioMinutes * 60 * 1000;

  const currentDuration = () =>
    accumulatedRef.current + (runStartRef.current === null ? 0 : performance.now() - runStartRef.current);

  // Trình duyệt có ghi âm được không + bản ghi còn sót từ lần trước (đóng tab, tải lại trang…).
  useEffect(() => {
    const canRecord =
      typeof window.MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
    let cancelled = false;
    loadRecording(meetingId).then((found) => {
      if (cancelled) return;
      setSupported(canRecord);
      if (found) {
        setSaved({
          blob: new Blob(found.chunks, { type: recordingFileType(found.meta.mimeType).type }),
          mimeType: found.meta.mimeType,
          startedAt: found.meta.startedAt,
          durationMs: found.meta.durationMs,
          recovered: true,
        });
        setElapsedMs(found.meta.durationMs);
        setPhase("stopped");
      } else {
        setPhase("idle");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const stopMeter = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockLike> } };
      if (nav.wakeLock && !wakeLockRef.current) wakeLockRef.current = await nav.wakeLock.request("screen");
    } catch {
      // Không giữ được màn hình sáng thì vẫn ghi bình thường.
    }
  }, []);

  /** Dọn micro, đồng hồ, thanh âm lượng — gọi khi dừng hoặc khi rời trang. */
  const releaseDevices = useCallback(() => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    stopMeter();
    releaseWakeLock();
  }, [releaseWakeLock, stopMeter]);

  const stopRecording = useCallback((message?: string) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (runStartRef.current !== null) {
      accumulatedRef.current += performance.now() - runStartRef.current;
      runStartRef.current = null;
    }
    if (message) setNotice(message);
    recorder.stop();
  }, []);

  // Dừng và dọn dẹp nếu người dùng chuyển sang trang khác trong app (phần đã ghi vẫn nằm trên máy).
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      releaseDevices();
    },
    [releaseDevices]
  );

  // Đang ghi mà đóng tab/tải lại: trình duyệt hỏi lại cho chắc.
  useEffect(() => {
    if (phase !== "recording" && phase !== "paused") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const regainWakeLock = () => {
      if (document.visibilityState === "visible") void requestWakeLock();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("visibilitychange", regainWakeLock);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("visibilitychange", regainWakeLock);
    };
  }, [phase, requestWakeLock]);

  function startMeter(stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      audioCtxRef.current = ctx;
      const data = new Uint8Array(analyser.fftSize);
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) sum += ((value - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      // Không có thanh âm lượng cũng không sao.
    }
  }

  async function start() {
    setError(null);
    setNotice(null);
    if (!consent) return setError("Hãy xác nhận đã báo cho người tham dự rằng cuộc họp được ghi âm.");
    const mimeType = pickRecordingMimeType((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) return setError("Trình duyệt này không ghi âm được. Hãy dùng Chrome, Edge hoặc Safari mới, hoặc tải file lên.");

    setPhase("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (err) {
      setError(microphoneErrorMessage(err));
      setPhase("idle");
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: RECORDING_BITS_PER_SECOND });
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      setError("Trình duyệt này không ghi âm được. Hãy dùng Chrome, Edge hoặc Safari mới, hoặc tải file lên.");
      setPhase("idle");
      return;
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    seqRef.current = 0;
    accumulatedRef.current = 0;
    runStartRef.current = performance.now();
    setStorageOk(true);
    const meta: RecordingMeta = {
      meetingId,
      mimeType: recorder.mimeType || mimeType,
      startedAt: Date.now(),
      durationMs: 0,
      updatedAt: Date.now(),
    };
    metaRef.current = meta;

    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      chunksRef.current.push(event.data);
      const seq = seqRef.current++;
      const snapshot = { ...meta, durationMs: currentDuration(), updatedAt: Date.now() };
      void saveRecordingChunk(snapshot, seq, event.data).then((ok) => {
        if (!ok) setStorageOk(false);
      });
    };
    recorder.onerror = () => stopRecording("Ghi âm bị gián đoạn. Phần đã ghi vẫn được giữ.");
    recorder.onstop = () => {
      const durationMs = accumulatedRef.current;
      releaseDevices();
      void saveRecordingMeta({ ...meta, durationMs, updatedAt: Date.now() });
      setSaved({
        blob: new Blob(chunksRef.current, { type: recordingFileType(meta.mimeType).type }),
        mimeType: meta.mimeType,
        startedAt: meta.startedAt,
        durationMs,
        recovered: false,
      });
      setElapsedMs(durationMs);
      setPhase("stopped");
    };
    stream.getAudioTracks()[0]?.addEventListener("ended", () =>
      stopRecording("Micro đã bị ngắt. Phần đã ghi vẫn được giữ.")
    );

    recorder.start(RECORDING_CHUNK_MS);
    setElapsedMs(0);
    setPhase("recording");
    startMeter(stream);
    void requestWakeLock();
    tickRef.current = window.setInterval(() => {
      const duration = currentDuration();
      setElapsedMs(duration);
      if (duration >= maxMs) stopRecording(`Đã tới giới hạn ${formatLimit(maxAudioMinutes)} mỗi bản ghi nên app tự dừng.`);
    }, 500);
  }

  function pause() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.pause();
    if (runStartRef.current !== null) accumulatedRef.current += performance.now() - runStartRef.current;
    runStartRef.current = null;
    setElapsedMs(accumulatedRef.current);
    setPhase("paused");
    if (metaRef.current) {
      void saveRecordingMeta({ ...metaRef.current, durationMs: accumulatedRef.current, updatedAt: Date.now() });
    }
  }

  function resume() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    recorder.resume();
    runStartRef.current = performance.now();
    setPhase("recording");
  }

  async function discard() {
    if (!window.confirm("Xoá bản ghi này? Không khôi phục được.")) return;
    await clearRecording(meetingId);
    setSaved(null);
    setElapsedMs(0);
    setNotice(null);
    setError(null);
    setPhase("idle");
  }

  async function submit() {
    if (!saved) return;
    setError(null);
    setPhase("uploading");
    setProgress(0);
    try {
      const { type } = recordingFileType(saved.mimeType);
      const file = new File([saved.blob], recordingFileName(saved.mimeType, new Date(saved.startedAt)), { type });
      await uploadRecapAudio({
        meetingId,
        file,
        durationSeconds: Math.max(1, Math.round(saved.durationMs / 1000)),
        maxAudioMinutes,
        onProgress: setProgress,
      });
      await clearRecording(meetingId);
      setSaved(null);
      notify({ message: "Đã tải bản ghi lên. AI đang chép lời và viết biên bản…", tone: "success" });
      onUploaded();
    } catch (err) {
      setError(friendlyUploadError(err));
      setPhase("stopped");
    }
  }

  const playUrl = useMemo(() => (saved ? URL.createObjectURL(saved.blob) : null), [saved]);
  useEffect(() => () => {
    if (playUrl) URL.revokeObjectURL(playUrl);
  }, [playUrl]);

  if (phase === "loading" || supported === null) {
    return <p className="py-4 text-sm text-zinc-500">Đang kiểm tra micro…</p>;
  }

  const live = phase === "recording" || phase === "paused";

  return (
    <div className="space-y-3">
      {!supported && !saved && (
        <p className="rounded-[7px] bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Trình duyệt này không ghi âm được. Hãy dùng Chrome, Edge hoặc Safari mới, hoặc chuyển sang “Tải file lên”.
        </p>
      )}

      {(phase === "idle" || phase === "requesting") && supported && (
        <>
          <label className="flex items-start gap-2.5 text-sm leading-6 text-zinc-600">
            <input
              type="checkbox"
              checked={consent}
              disabled={phase === "requesting"}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-[#a8d431]"
            />
            Tôi đã báo cho người tham dự biết cuộc họp được ghi âm. File ghi âm bị xoá ngay sau khi chép lời.
          </label>
          <ul className="list-disc space-y-0.5 pl-5 text-xs leading-5 text-zinc-500">
            <li>Đặt máy gần người nói. Ghi tối đa {formatLimit(maxAudioMinutes)} mỗi lần.</li>
            <li>Trên điện thoại: giữ màn hình mở và ở lại trang này trong lúc ghi.</li>
            <li>Bản ghi được lưu dần trên máy này, lỡ đóng tab vẫn còn.</li>
          </ul>
          <button
            type="button"
            onClick={start}
            disabled={phase === "requesting"}
            className="tf-button-primary"
          >
            <Mic size={16} aria-hidden="true" />
            {phase === "requesting" ? "Đang bật micro…" : "Bắt đầu ghi âm"}
          </button>
        </>
      )}

      {live && (
        <div className="rounded-[8px] border border-red-200 bg-red-50/60 px-4 py-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`h-3 w-3 shrink-0 rounded-full bg-red-500 ${phase === "recording" ? "animate-pulse" : "opacity-40"}`}
              aria-hidden="true"
            />
            <span className="text-sm font-medium text-red-800">
              {phase === "recording" ? "Đang ghi âm" : "Đã tạm dừng"}
            </span>
            <span className="ml-auto font-mono text-2xl tabular-nums text-zinc-900">{formatClock(elapsedMs / 1000)}</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white" aria-hidden="true">
            <div className="h-full rounded-full bg-red-400 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-zinc-600">
            Đừng đóng tab trong lúc ghi. Thanh đỏ nhấp nháy theo tiếng nói nghĩa là micro đang thu.
          </p>
          {!storageOk && (
            <p className="mt-2 text-xs text-amber-800">
              Trình duyệt không cho lưu tạm trên máy (chế độ ẩn danh?). Bản ghi vẫn chạy, nhưng đóng tab sẽ mất.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {phase === "recording" ? (
              <button type="button" onClick={pause} className="tf-button-secondary !min-h-9 !px-3 text-xs">
                <Pause size={14} aria-hidden="true" />
                Tạm dừng
              </button>
            ) : (
              <button type="button" onClick={resume} className="tf-button-secondary !min-h-9 !px-3 text-xs">
                <Play size={14} aria-hidden="true" />
                Ghi tiếp
              </button>
            )}
            <button type="button" onClick={() => stopRecording()} className="tf-button-primary !min-h-9 !px-3 text-xs">
              <Square size={14} aria-hidden="true" />
              Dừng ghi
            </button>
          </div>
        </div>
      )}

      {(phase === "stopped" || phase === "uploading") && saved && (
        <div className="space-y-3 rounded-[8px] border border-zinc-200 px-4 py-4">
          <p className="text-sm font-medium text-zinc-900">
            {saved.recovered ? "Có bản ghi chưa gửi trên máy này" : "Đã ghi xong"} ·{" "}
            <span className="tabular-nums">{formatClock(saved.durationMs / 1000)}</span>
            <span className="font-normal text-zinc-500">
              {" "}
              ·{" "}
              {saved.blob.size >= MB
                ? `${(saved.blob.size / MB).toFixed(1)} MB`
                : `${Math.max(1, Math.round(saved.blob.size / 1024))} KB`}
            </span>
          </p>
          {playUrl && (
            <audio controls preload="metadata" src={playUrl} className="w-full">
              Trình duyệt không phát được bản ghi.
            </audio>
          )}
          {phase === "uploading" ? (
            <div className="space-y-1.5" aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-zinc-500">Đang tải lên… {progress}%</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={submit} className="tf-button-primary">
                <Upload size={16} aria-hidden="true" />
                Tạo biên bản từ bản ghi này
              </button>
              <button type="button" onClick={discard} className="tf-button-secondary">
                <Trash2 size={16} aria-hidden="true" />
                Xoá bản ghi
              </button>
            </div>
          )}
        </div>
      )}

      {notice && <p className="rounded-[7px] bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>}
      {error && (
        <p role="alert" className="rounded-[7px] bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
