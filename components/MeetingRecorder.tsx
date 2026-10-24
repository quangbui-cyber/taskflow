"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ExternalLink, Mic, Pause, Play, Square, Trash2, Upload, Video } from "lucide-react";
import { useInteraction } from "@/components/InteractionProvider";
import { formatClock } from "@/lib/meetingRecap";
import {
  RECORDING_BITS_PER_SECOND,
  RECORDING_CHUNK_MS,
  NO_TAB_AUDIO_MESSAGE,
  canRecordTabAudio,
  displayCaptureErrorMessage,
  microphoneErrorMessage,
  pickRecordingMimeType,
  recordingFileName,
  recordingFileType,
  OVERTIME_EXTEND_MS,
  SILENCE_TRIM_KEEP_MS,
  trimChunks,
  SPEECH_RMS_THRESHOLD,
  autoStopMessage,
  autoStopState,
  initialAutoStopEndsAt,
  rms,
  shouldAutoSubmitRecording,
  micOptions,
  preferredMicId,
  type MicOption,
  type RecordingSource,
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
const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};
const MIC_STORAGE_KEY = "taskflow-mic-id";

function micConstraints(deviceId: string): MediaTrackConstraints {
  return deviceId ? { ...MIC_CONSTRAINTS, deviceId: { exact: deviceId } } : MIC_CONSTRAINTS;
}

function readSavedMic(): string | null {
  try {
    return window.localStorage.getItem(MIC_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveMic(deviceId: string) {
  try {
    window.localStorage.setItem(MIC_STORAGE_KEY, deviceId);
  } catch {
    // Không lưu được thì lần sau chọn lại.
  }
}

export default function MeetingRecorder({
  meetingId,
  meetingUrl,
  autoStart = false,
  meetingEndsAt = null,
  maxAudioMinutes,
  onUploaded,
}: {
  meetingId: string;
  /** Link họp online (nếu có) — để gợi ý chế độ "Họp online" và mở nhanh cuộc họp. */
  meetingUrl: string | null;
  /** Mở từ thông báo "cuộc họp đã bắt đầu": họp trực tiếp thì ghi ngay, họp online thì nhắc bấm Bắt đầu. */
  autoStart?: boolean;
  /** Giờ kết thúc theo lịch (ISO): quá 10 phút mà chưa dừng thì app tự dừng. */
  meetingEndsAt?: string | null;
  maxAudioMinutes: number;
  onUploaded: () => void;
}) {
  const { notify } = useInteraction();
  const router = useRouter();
  const pathname = usePathname();
  const autoStartedRef = useRef(false);
  // Đặt true khi tab họp đóng / dừng chia sẻ: dừng ghi xong thì tự tạo biên bản.
  const autoSubmitRef = useRef(false);
  const autoSubmitMessageRef = useRef<string | null>(null);
  // Tự dừng khi quá giờ kết thúc 10 phút hoặc im lặng 10 phút (cả họp trực tiếp lẫn online).
  const autoStopEnabledRef = useRef(false);
  const endsAtRef = useRef<number | null>(null);
  const lastSoundAtRef = useRef(0);
  // Thời lượng đã ghi tại lần cuối có tiếng nói; tự dừng vì im lặng thì cắt bản ghi tại đây (+30 giây).
  const soundAtDurationRef = useRef(0);
  const trimToMsRef = useRef<number | null>(null);
  const [autoStopInfo, setAutoStopInfo] = useState<{ overtimeLeftMs: number | null; silenceLeftMs: number | null }>({
    overtimeLeftMs: null,
    silenceLeftMs: null,
  });
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const [startPrompt, setStartPrompt] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [canOnline, setCanOnline] = useState(false);
  const [source, setSource] = useState<RecordingSource>("mic");
  const [liveLabel, setLiveLabel] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [saved, setSaved] = useState<SavedRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const [progress, setProgress] = useState(0);
  // Micro đang chọn ("" = micro mặc định của máy) và danh sách micro trên máy.
  const [mics, setMics] = useState<MicOption[]>([]);
  const [micId, setMicId] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [switchingMic, setSwitchingMic] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const mixCtxRef = useRef<AudioContext | null>(null);
  const mixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  // Nhánh micro trong bộ trộn (họp online), tách riêng để đổi micro ngay lúc đang ghi.
  const micNodesRef = useRef<AudioNode[]>([]);
  const chunksRef = useRef<Blob[]>([]);
  // Thời lượng đã ghi lúc nhận từng đoạn, dùng để cắt đúng chỗ khi tự dừng vì im lặng.
  const chunkEndsRef = useRef<number[]>([]);
  const seqRef = useRef(0);
  const metaRef = useRef<RecordingMeta | null>(null);
  const accumulatedRef = useRef(0);
  const runStartRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<WakeLockLike | null>(null);
  const maxMs = maxAudioMinutes * 60 * 1000;

  const currentDuration = () =>
    accumulatedRef.current + (runStartRef.current === null ? 0 : performance.now() - runStartRef.current);

  // Trình duyệt có ghi âm được không + bản ghi còn sót từ lần trước (đóng tab, tải lại trang…).
  useEffect(() => {
    const canRecord =
      typeof window.MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
    const tabAudio = canRecord && canRecordTabAudio(navigator.userAgent, Boolean(navigator.mediaDevices?.getDisplayMedia));
    let cancelled = false;
    loadRecording(meetingId).then((found) => {
      if (cancelled) return;
      setSupported(canRecord);
      setCanOnline(tabAudio);
      // Cuộc họp có link online thì mặc định ghi tab họp + micro.
      if (tabAudio && meetingUrl) setSource("online");
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
  }, [meetingId, meetingUrl]);

  const refreshMics = useCallback(async (): Promise<MicOption[]> => {
    try {
      const options = micOptions(await navigator.mediaDevices.enumerateDevices());
      setMics(options);
      setMicId((current) =>
        current && options.some((option) => option.deviceId === current) ? current : preferredMicId(options, readSavedMic())
      );
      return options;
    } catch {
      return [];
    }
  }, []);

  // Danh sách micro: lúc mở trang và mỗi khi cắm/rút micro, tai nghe.
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const onChange = () => void refreshMics();
    const first = window.setTimeout(onChange, 0);
    navigator.mediaDevices.addEventListener?.("devicechange", onChange);
    return () => {
      window.clearTimeout(first);
      navigator.mediaDevices.removeEventListener?.("devicechange", onChange);
    };
  }, [refreshMics]);

  const stopMeter = useCallback(() => {
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
    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current = null;
    mixCtxRef.current?.close().catch(() => {});
    mixCtxRef.current = null;
    mixDestRef.current = null;
    micNodesRef.current = [];
    setMicLevel(0);
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

  /**
   * Đo âm lượng ngay trên luồng âm thanh (không dùng vòng vẽ của trình duyệt, vốn dừng khi tab bị ẩn),
   * vừa để vẽ thanh âm lượng vừa để biết lần cuối có tiếng nói.
   */
  function startMeter(stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      void ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const silent = ctx.createGain();
      silent.gain.value = 0;
      processor.onaudioprocess = (event) => {
        const level = rms(event.inputBuffer.getChannelData(0));
        if (level > SPEECH_RMS_THRESHOLD) {
          lastSoundAtRef.current = Date.now();
          soundAtDurationRef.current = currentDuration();
        }
        setLevel(Math.min(1, level * 4));
      };
      source.connect(processor);
      processor.connect(silent);
      silent.connect(ctx.destination);
      audioCtxRef.current = ctx;
    } catch {
      // Không đo được âm lượng thì vẫn ghi bình thường (chỉ không tự dừng khi im lặng).
    }
  }

  /**
   * Mở micro đã chọn; micro đó đã bị rút thì dùng micro mặc định. Lần đầu cho phép micro trình duyệt mới
   * cho biết tên: nếu micro mặc định là micro ảo (Zoom, Teams, BlackHole…) thì đổi sang micro thật.
   */
  async function openMic(deviceId: string): Promise<MediaStream> {
    let id = deviceId;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(id) });
    } catch (err) {
      if (!id) throw err;
      id = "";
      stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints("") });
    }
    const options = await refreshMics();
    if (!id) {
      const better = preferredMicId(options, null);
      if (better) {
        try {
          const real = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(better) });
          stream.getTracks().forEach((track) => track.stop());
          stream = real;
          id = better;
        } catch {
          // Giữ micro mặc định.
        }
      }
    }
    setMicId(id);
    return stream;
  }

  async function acquireMicStream(): Promise<MediaStream | null> {
    try {
      const mic = await openMic(micId);
      streamRef.current = mic;
      return mic;
    } catch (err) {
      setError(microphoneErrorMessage(err));
      return null;
    }
  }

  /** Nối micro vào bộ trộn (họp online) kèm thanh âm lượng riêng của micro. */
  function attachMicToMix(mic: MediaStream) {
    const ctx = mixCtxRef.current;
    const dest = mixDestRef.current;
    if (!ctx || !dest) return;
    micNodesRef.current.forEach((node) => node.disconnect());
    const source = ctx.createMediaStreamSource(mic);
    source.connect(dest);
    const nodes: AudioNode[] = [source];
    try {
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      const silent = ctx.createGain();
      silent.gain.value = 0;
      processor.onaudioprocess = (event) => setMicLevel(Math.min(1, rms(event.inputBuffer.getChannelData(0)) * 4));
      source.connect(processor);
      processor.connect(silent);
      silent.connect(ctx.destination);
      nodes.push(processor, silent);
    } catch {
      // Không đo được âm lượng micro thì vẫn ghi bình thường.
    }
    micNodesRef.current = nodes;
  }

  /** Chọn micro khác. Đang ghi họp online thì đổi ngay, bản ghi không bị ngắt. */
  async function chooseMic(deviceId: string) {
    setMicId(deviceId);
    saveMic(deviceId);
    if (source !== "online" || !mixCtxRef.current) return;
    setSwitchingMic(true);
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId) });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = next;
      attachMicToMix(next);
      setLiveLabel("tab họp + micro");
      setNotice(null);
    } catch (err) {
      setError(microphoneErrorMessage(err));
    } finally {
      setSwitchingMic(false);
    }
  }

  /** Chưa cho phép micro thì trình duyệt giấu tên micro: xin quyền một lần rồi tắt ngay để hiện danh sách. */
  async function revealMics() {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((track) => track.stop());
      await refreshMics();
    } catch (err) {
      setError(microphoneErrorMessage(err));
    }
  }

  /**
   * Họp online: chia sẻ tab cuộc họp (lấy tiếng mọi người) rồi trộn với micro (giọng mình).
   * Gọi chia sẻ tab trước tiên vì trình duyệt chỉ cho phép ngay sau cú bấm.
   */
  async function acquireOnlineStream(): Promise<MediaStream | null> {
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: { suppressLocalAudioPlayback: false },
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        systemAudio: "include",
      } as DisplayMediaStreamOptions);
    } catch (err) {
      setError(displayCaptureErrorMessage(err));
      return null;
    }
    if (display.getAudioTracks().length === 0) {
      display.getTracks().forEach((track) => track.stop());
      setError(NO_TAB_AUDIO_MESSAGE);
      return null;
    }
    displayStreamRef.current = display;

    let mic: MediaStream | null = null;
    try {
      mic = await openMic(micId);
      streamRef.current = mic;
    } catch {
      setNotice("Không bật được micro nên chỉ ghi tiếng từ tab cuộc họp (không có giọng của bạn). Chọn micro khác ở dưới.");
    }

    try {
      const ctx = new AudioContext();
      await ctx.resume().catch(() => {});
      const mixed = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(mixed);
      mixCtxRef.current = ctx;
      mixDestRef.current = mixed;
      if (mic) attachMicToMix(mic);
      return mixed.stream;
    } catch {
      releaseDevices();
      setError("Không trộn được âm thanh tab và micro. Tải lại trang rồi thử lại.");
      return null;
    }
  }

  async function start() {
    setError(null);
    setNotice(null);
    const mimeType = pickRecordingMimeType((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) return setError("Trình duyệt này không ghi âm được. Hãy dùng Chrome, Edge hoặc Safari mới, hoặc tải file lên.");

    setPhase("requesting");
    const acquired = source === "online" ? await acquireOnlineStream() : await acquireMicStream();
    if (!acquired) {
      setPhase("idle");
      return;
    }
    const stream = acquired;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: RECORDING_BITS_PER_SECOND });
    } catch {
      releaseDevices();
      setError("Trình duyệt này không ghi âm được. Hãy dùng Chrome, Edge hoặc Safari mới, hoặc tải file lên.");
      setPhase("idle");
      return;
    }

    recorderRef.current = recorder;
    setLiveLabel(source === "online" ? (streamRef.current ? "tab họp + micro" : "chỉ tab họp") : null);
    chunksRef.current = [];
    chunkEndsRef.current = [];
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
      chunkEndsRef.current.push(currentDuration());
      const seq = seqRef.current++;
      const snapshot = { ...meta, durationMs: currentDuration(), updatedAt: Date.now() };
      void saveRecordingChunk(snapshot, seq, event.data).then((ok) => {
        if (!ok) setStorageOk(false);
      });
    };
    recorder.onerror = () => stopRecording("Ghi âm bị gián đoạn. Phần đã ghi vẫn được giữ.");
    recorder.onstop = () => {
      let durationMs = accumulatedRef.current;
      // Tự dừng vì im lặng: bỏ phần im lặng phía sau để không tốn phí chép lời và tránh AI chép bịa.
      const trimTo = trimToMsRef.current;
      trimToMsRef.current = null;
      if (trimTo !== null && trimTo < durationMs && chunkEndsRef.current.length === chunksRef.current.length) {
        const trimmed = trimChunks(chunkEndsRef.current, trimTo);
        if (trimmed.keep < chunksRef.current.length) {
          chunksRef.current = chunksRef.current.slice(0, trimmed.keep);
          chunkEndsRef.current = chunkEndsRef.current.slice(0, trimmed.keep);
          durationMs = Math.min(durationMs, trimmed.durationMs);
        }
      }
      releaseDevices();
      // Bản lưu tạm trên máy vẫn giữ đủ mọi đoạn, nên ghi thời lượng đầy đủ cho khớp.
      void saveRecordingMeta({ ...meta, durationMs: accumulatedRef.current, updatedAt: Date.now() });
      const recording: SavedRecording = {
        blob: new Blob(chunksRef.current, { type: recordingFileType(meta.mimeType).type }),
        mimeType: meta.mimeType,
        startedAt: meta.startedAt,
        durationMs,
        recovered: false,
      };
      setSaved(recording);
      setElapsedMs(durationMs);
      setPhase("stopped");

      if (autoSubmitRef.current) {
        autoSubmitRef.current = false;
        const message =
          autoSubmitMessageRef.current ??
          "Cuộc họp online đã kết thúc (tab họp đã đóng). App đã dừng ghi và đang tạo biên bản…";
        autoSubmitMessageRef.current = null;
        if (shouldAutoSubmitRecording(durationMs)) {
          setNotice(message);
          void submitRef.current(recording);
        } else {
          setNotice("App đã dừng ghi. Bản ghi dưới 30 giây nên chưa tự tạo biên bản.");
        }
      }
    };
    if (source === "online") {
      // Đóng tab họp hoặc bấm "Dừng chia sẻ" = cuộc họp kết thúc: dừng ghi rồi tự tạo biên bản.
      displayStreamRef.current?.getTracks().forEach((track) =>
        track.addEventListener("ended", () => {
          autoSubmitRef.current = true;
          stopRecording();
        })
      );
    } else {
      streamRef.current?.getAudioTracks()[0]?.addEventListener("ended", () =>
        stopRecording("Micro đã bị ngắt. Phần đã ghi vẫn được giữ.")
      );
    }

    recorder.start(RECORDING_CHUNK_MS);
    setElapsedMs(0);
    setPhase("recording");
    startMeter(stream);
    void requestWakeLock();
    // Cả họp trực tiếp lẫn họp online: lỡ quên dừng (hoặc rời Meet mà không đóng tab) thì app tự dừng.
    autoStopEnabledRef.current = true;
    endsAtRef.current = initialAutoStopEndsAt(meetingEndsAt ? Date.parse(meetingEndsAt) : null, Date.now());
    lastSoundAtRef.current = Date.now();
    soundAtDurationRef.current = 0;
    trimToMsRef.current = null;
    setAutoStopInfo({ overtimeLeftMs: null, silenceLeftMs: null });
    tickRef.current = window.setInterval(() => {
      const duration = currentDuration();
      setElapsedMs(duration);
      if (duration >= maxMs) {
        stopRecording(`Đã tới giới hạn ${formatLimit(maxAudioMinutes)} mỗi bản ghi nên app tự dừng.`);
        return;
      }
      if (!autoStopEnabledRef.current) return;
      const state = autoStopState({
        nowMs: Date.now(),
        endsAtMs: endsAtRef.current,
        lastSoundAtMs: lastSoundAtRef.current,
        paused: recorderRef.current?.state === "paused",
      });
      setAutoStopInfo({ overtimeLeftMs: state.overtimeLeftMs, silenceLeftMs: state.silenceLeftMs });
      if (state.stop) {
        if (state.stop === "silence") trimToMsRef.current = soundAtDurationRef.current + SILENCE_TRIM_KEEP_MS;
        autoSubmitRef.current = true;
        autoSubmitMessageRef.current = autoStopMessage(state.stop);
        stopRecording();
      }
    }, 500);
  }

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  // Luôn trỏ tới hàm start mới nhất để hiệu ứng tự ghi âm gọi được mà không phụ thuộc mỗi lần render.
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });

  // Mở từ thông báo "cuộc họp đã bắt đầu": họp trực tiếp thì ghi ngay; họp online thì trình duyệt
  // bắt buộc người dùng tự bấm để chọn tab, nên chỉ đưa nút Bắt đầu lên trước mắt.
  useEffect(() => {
    if (!autoStart || autoStartedRef.current || phase !== "idle" || supported !== true) return;
    autoStartedRef.current = true;
    window.setTimeout(() => {
      if (source === "online") {
        setStartPrompt(true);
        startButtonRef.current?.scrollIntoView({ block: "center" });
        startButtonRef.current?.focus();
      } else {
        void startRef.current();
      }
      // Bỏ ?record=1 để tải lại trang không tự ghi lần nữa.
      router.replace(pathname, { scroll: false });
    }, 0);
  }, [autoStart, phase, supported, source, router, pathname]);

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
    lastSoundAtRef.current = Date.now();
    soundAtDurationRef.current = currentDuration();
    setPhase("recording");
  }

  /** Người tổ chức bấm "Vẫn đang họp": lùi giờ tự dừng và đếm lại thời gian im lặng. */
  function keepRecording() {
    lastSoundAtRef.current = Date.now();
    soundAtDurationRef.current = currentDuration();
    if (endsAtRef.current !== null && Date.now() >= endsAtRef.current) {
      endsAtRef.current = Date.now() + OVERTIME_EXTEND_MS;
    }
    setAutoStopInfo({ overtimeLeftMs: null, silenceLeftMs: null });
  }

  function stopAndCreateRecap() {
    autoSubmitRef.current = true;
    autoSubmitMessageRef.current = "Đã dừng ghi và đang tạo biên bản…";
    stopRecording();
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

  async function submit(recording: SavedRecording | null = saved) {
    if (!recording) return;
    const saved = recording;
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
  const micValue = micId || mics[0]?.deviceId || "";
  const micPicker = mics.length > 0 ? (
    <div className="relative min-w-0">
      <select
        aria-label="Micro dùng để ghi"
        value={micValue}
        disabled={phase === "requesting" || switchingMic}
        onChange={(event) => void chooseMic(event.target.value)}
        className="tf-field appearance-none !pr-11"
      >
        {mics.map((mic) => (
          <option key={mic.deviceId} value={mic.deviceId}>
            {mic.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500"
        aria-hidden="true"
      />
    </div>
  ) : (
    <button type="button" onClick={() => void revealMics()} className="tf-button-secondary !min-h-9 !px-3 text-xs">
      <Mic size={14} aria-hidden="true" />
      Chọn micro
    </button>
  );

  return (
    <div className="space-y-3">
      {!supported && !saved && (
        <p className="rounded-[7px] bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Trình duyệt này không ghi âm được. Hãy dùng Chrome, Edge hoặc Safari mới, hoặc chuyển sang “Tải file lên”.
        </p>
      )}

      {(phase === "idle" || phase === "requesting") && supported && (
        <>
          {canOnline ? (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Loại cuộc họp">
              {(
                [
                  { key: "mic", icon: Mic, title: "Họp trực tiếp" },
                  { key: "online", icon: Video, title: "Họp online (Meet, Zoom…)" },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={source === option.key}
                  disabled={phase === "requesting"}
                  onClick={() => setSource(option.key)}
                  className={`flex items-center gap-2.5 rounded-[8px] border px-3 py-2.5 text-left transition-colors ${
                    source === option.key
                      ? "border-brand-400 bg-brand-50/60 ring-1 ring-brand-300"
                      : "border-zinc-200 hover:border-zinc-300"
                  }`}
                >
                  <option.icon size={18} className="shrink-0 text-zinc-500" aria-hidden="true" />
                  <span className="text-sm font-medium text-zinc-900">{option.title}</span>
                </button>
              ))}
            </div>
          ) : (
            meetingUrl && (
              <p className="rounded-[7px] bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-600">
                Muốn ghi cả tiếng mọi người trong cuộc họp online, hãy mở trang này bằng Chrome hoặc Edge trên máy tính.
              </p>
            )
          )}

          {source === "online" && canOnline ? (
            <ol className="list-decimal space-y-0.5 pl-5 text-xs leading-5 text-zinc-600">
              <li>
                Mở cuộc họp ở một tab khác
                {meetingUrl?.startsWith("https://") && (
                  <>
                    {" "}
                    (
                    <a
                      href={meetingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 font-medium text-brand-700 hover:underline"
                    >
                      mở link họp
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                    )
                  </>
                )}
                .
              </li>
              <li>
                Bấm <strong>Bắt đầu ghi âm</strong>, chọn tab cuộc họp và bật <strong>“Chia sẻ âm thanh của tab”</strong>, rồi bấm
                Chia sẻ.
              </li>
              <li>Cho phép micro để ghi cả giọng của bạn. Giữ cả hai tab mở đến khi họp xong.</li>
              <li>
                Họp xong chỉ cần đóng tab họp. Lỡ quên thì app tự dừng khi quá giờ kết thúc 10 phút hoặc im lặng 10 phút,
                rồi tự tạo biên bản.
              </li>
            </ol>
          ) : (
            <ul className="list-disc space-y-0.5 pl-5 text-xs leading-5 text-zinc-500">
              <li>Đặt máy gần người nói. Ghi tối đa {formatLimit(maxAudioMinutes)} mỗi lần.</li>
              <li>Trên điện thoại: giữ màn hình mở và ở lại trang này trong lúc ghi.</li>
              <li>Bản ghi được lưu dần trên máy này, lỡ đóng tab vẫn còn. File ghi âm bị xoá ngay sau khi chép lời.</li>
            </ul>
          )}
          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-700">Micro</p>
            {micPicker}
          </div>
          {startPrompt && (
            <p className="rounded-[7px] bg-brand-50 px-3 py-2 text-sm leading-6 text-brand-900">
              Cuộc họp đã bắt đầu. Bấm <strong>Bắt đầu ghi âm</strong>, chọn tab cuộc họp và bật{" "}
              <strong>“Chia sẻ âm thanh của tab”</strong>.
            </p>
          )}
          <button
            ref={startButtonRef}
            type="button"
            onClick={() => {
              setStartPrompt(false);
              void start();
            }}
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
              {liveLabel && <span className="font-normal text-red-700"> · {liveLabel}</span>}
            </span>
            <span className="ml-auto font-mono text-2xl tabular-nums text-zinc-900">{formatClock(elapsedMs / 1000)}</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white" aria-hidden="true">
            <div className="h-full rounded-full bg-red-400 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          {source === "online" && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-xs text-zinc-600">Giọng của bạn</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-[width] duration-75"
                    style={{ width: `${Math.round(micLevel * 100)}%` }}
                  />
                </div>
              </div>
              {micPicker}
            </div>
          )}
          <p className="mt-2 text-xs text-zinc-600">
            {liveLabel
              ? "Đừng đóng tab này và tab cuộc họp trong lúc ghi. Thanh đỏ nhấp nháy theo tiếng nói nghĩa là đang thu."
              : "Đừng đóng tab trong lúc ghi. Thanh đỏ nhấp nháy theo tiếng nói nghĩa là micro đang thu."}
          </p>
          {(autoStopInfo.overtimeLeftMs !== null || autoStopInfo.silenceLeftMs !== null) && (
            <div className="mt-3 space-y-2 rounded-[7px] bg-amber-50 px-3 py-2.5 text-sm text-amber-900" role="status">
              {autoStopInfo.overtimeLeftMs !== null && (
                <p>
                  Đã quá giờ kết thúc cuộc họp. App sẽ tự dừng ghi và tạo biên bản sau{" "}
                  <strong className="tabular-nums">{formatClock(autoStopInfo.overtimeLeftMs / 1000)}</strong>.
                </p>
              )}
              {autoStopInfo.silenceLeftMs !== null && (
                <p>
                  Không nghe thấy tiếng nói. App sẽ tự dừng ghi và tạo biên bản sau{" "}
                  <strong className="tabular-nums">{formatClock(autoStopInfo.silenceLeftMs / 1000)}</strong>.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={stopAndCreateRecap} className="tf-button-primary !min-h-8 !px-3 text-xs">
                  Dừng và tạo biên bản
                </button>
                <button type="button" onClick={keepRecording} className="tf-button-secondary !min-h-8 !px-3 text-xs">
                  {autoStopInfo.overtimeLeftMs !== null ? "Vẫn đang họp (+30 phút)" : "Vẫn đang họp"}
                </button>
              </div>
            </div>
          )}
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
              <button type="button" onClick={() => void submit()} className="tf-button-primary">
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
