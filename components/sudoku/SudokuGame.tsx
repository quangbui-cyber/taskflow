"use client";

import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Eraser,
  Globe,
  Lightbulb,
  Pencil,
  Play,
  RotateCcw,
  Sparkles,
  Timer as TimerIcon,
  Trophy,
  Undo2,
  User,
  Volume2,
  VolumeX,
  Flag,
} from "lucide-react";
import {
  CELLS,
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  MAX_HINTS,
  MAX_MISTAKES,
  TIME_LIMIT_SEC,
  colOf,
  formatClock,
  generatePuzzle,
  isDifficulty,
  isSolved,
  pickHintCell,
  rowOf,
  type Grid,
  type SudokuDifficulty,
} from "@/lib/sudoku";
import { caroSound as sound } from "@/lib/caroSound";
import SudokuBoard from "./SudokuBoard";
import GameLeaderboard from "@/components/GameLeaderboard";
import {
  createSudokuRoom,
  forfeitSudokuRound,
  getSudokuRoom,
  joinSudokuRoom,
  startSudokuRound,
  submitSudokuCell,
  updateSudokuRoomSettings,
  type SudokuOnlineState,
} from "@/app/actions/sudokuOnline";

type Mode = "solo" | "online";
type SoloStatus = "idle" | "playing" | "won" | "lost";

type SoloGame = {
  difficulty: SudokuDifficulty;
  puzzle: Grid;
  solution: Grid;
  values: Grid;
  notes: number[];
  mistakes: number;
  hintsLeft: number;
  elapsed: number;
  /** Mốc `elapsed` lúc bật đếm giờ, để bật giữa ván không bị thua ngay. */
  timerBase: number;
  status: SoloStatus;
  lostReason: "mistakes" | "timeout" | null;
};

type HistoryEntry = { index: number; value: number; notes: number };

const STORAGE_GAME = "mycreative_sudoku_solo";
const STORAGE_TIMER = "mycreative_sudoku_timer";
const STORAGE_BEST = "mycreative_sudoku_best";

const EMPTY_GRID: Grid = new Array(CELLS).fill(0);

function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Trình duyệt chặn lưu trữ: bỏ qua, game vẫn chơi được.
  }
}

function newSoloGame(difficulty: SudokuDifficulty, elapsed = 0): SoloGame {
  const { puzzle, solution } = generatePuzzle(difficulty);
  return {
    difficulty,
    puzzle,
    solution,
    values: [...puzzle],
    notes: new Array(CELLS).fill(0),
    mistakes: 0,
    hintsLeft: MAX_HINTS,
    elapsed,
    timerBase: 0,
    status: "playing",
    lostReason: null,
  };
}

/** Bỏ ghi chú số `n` ở các ô cùng hàng, cột, khối sau khi điền đúng. */
function clearPeerNotes(notes: number[], index: number, n: number): number[] {
  const next = [...notes];
  const bit = 1 << n;
  for (let j = 0; j < CELLS; j++) {
    if (
      rowOf(j) === rowOf(index) ||
      colOf(j) === colOf(index) ||
      (Math.floor(rowOf(j) / 3) === Math.floor(rowOf(index) / 3) &&
        Math.floor(colOf(j) / 3) === Math.floor(colOf(index) / 3))
    ) {
      next[j] &= ~bit;
    }
  }
  next[index] = 0;
  return next;
}

interface SudokuGameProps {
  initialRoomCode?: string | null;
}

export default function SudokuGame({ initialRoomCode = null }: SudokuGameProps) {
  const [mode, setMode] = useState<Mode>(initialRoomCode ? "online" : "solo");
  const [difficulty, setDifficulty] = useState<SudokuDifficulty>("medium");
  const [timerEnabled, setTimerEnabled] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [noteMode, setNoteMode] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [best, setBest] = useState<Partial<Record<SudokuDifficulty, number>>>({});

  // --- Chơi một mình ---
  const [solo, setSolo] = useState<SoloGame | null>(null);

  // --- Online ---
  const [roomCode, setRoomCode] = useState<string | null>(initialRoomCode);
  const [room, setRoom] = useState<SudokuOnlineState | null>(null);
  const [roomInput, setRoomInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Số sai hoặc đang chờ máy chủ xác nhận, chỉ hiện ở máy mình. */
  const [localEntries, setLocalEntries] = useState<Record<number, { value: number; wrong: boolean }>>({});
  const [onlineNotes, setOnlineNotes] = useState<number[]>(() => new Array(CELLS).fill(0));
  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Khôi phục cài đặt và ván đang chơi dở. localStorage chỉ đọc được sau khi trang đã hiển thị.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSoundOn(sound.isEnabled());
    const savedTimer = readStorage<boolean>(STORAGE_TIMER);
    if (savedTimer !== null) setTimerEnabled(savedTimer);
    setBest(readStorage(STORAGE_BEST) ?? {});
    const saved = readStorage<SoloGame>(STORAGE_GAME);
    if (saved && saved.status === "playing" && Array.isArray(saved.puzzle) && isDifficulty(saved.difficulty)) {
      setSolo(saved);
      setDifficulty(saved.difficulty);
    }
  }, []);

  useEffect(() => {
    if (solo) writeStorage(STORAGE_GAME, solo.status === "playing" ? solo : null);
  }, [solo]);

  // ================= CHƠI MỘT MÌNH =================

  const startSolo = useCallback(
    (level: SudokuDifficulty = difficulty) => {
      setSolo(newSoloGame(level));
      setSelected(null);
      setHistory([]);
      setNoteMode(false);
    },
    [difficulty]
  );

  // Đồng hồ: chỉ chạy khi đang chơi và tab đang mở.
  // Hết giờ thì thua; 10 giây cuối có tiếng tích tắc.
  const onSoloTick = useEffectEvent(() => {
    if (document.hidden || !solo || solo.status !== "playing") return;
    const left = TIME_LIMIT_SEC[solo.difficulty] - (solo.elapsed + 1 - solo.timerBase);
    const timedOut = timerEnabled && left <= 0;
    if (timedOut) sound.playTimeout();
    else if (timerEnabled && left <= 10) sound.playTick();
    setSolo((g) =>
      g && g.status === "playing"
        ? { ...g, elapsed: g.elapsed + 1, ...(timedOut ? { status: "lost" as const, lostReason: "timeout" as const } : {}) }
        : g
    );
  });
  const soloPlaying = mode === "solo" && solo?.status === "playing";
  useEffect(() => {
    if (!soloPlaying) return;
    const id = setInterval(() => onSoloTick(), 1000);
    return () => clearInterval(id);
  }, [soloPlaying]);

  const soloRemaining = solo ? TIME_LIMIT_SEC[solo.difficulty] - (solo.elapsed - solo.timerBase) : 0;

  const recordBest = (level: SudokuDifficulty, seconds: number) => {
    setBest((prev) => {
      if (prev[level] !== undefined && prev[level]! <= seconds) return prev;
      const next = { ...prev, [level]: seconds };
      writeStorage(STORAGE_BEST, next);
      return next;
    });
  };

  const soloInput = (n: number) => {
    if (!solo || solo.status !== "playing" || selected === null) return;
    const i = selected;
    if (solo.puzzle[i] !== 0 || solo.values[i] === solo.solution[i]) return;

    if (noteMode) {
      if (solo.values[i] !== 0) return;
      setHistory((h) => [...h, { index: i, value: 0, notes: solo.notes[i] }]);
      const notes = [...solo.notes];
      notes[i] ^= 1 << n;
      setSolo({ ...solo, notes });
      return;
    }

    if (solo.values[i] === n) return;
    const values = [...solo.values];
    values[i] = n;

    if (n === solo.solution[i]) {
      sound.playStone();
      const notes = clearPeerNotes(solo.notes, i, n);
      if (isSolved(values, solo.solution)) {
        sound.playWin();
        recordBest(solo.difficulty, solo.elapsed);
        setSolo({ ...solo, values, notes, status: "won" });
      } else {
        setSolo({ ...solo, values, notes });
      }
      // Ô đúng bị khoá nên không cần ghi lịch sử hoàn tác.
      return;
    }

    sound.playTimeout();
    const mistakes = solo.mistakes + 1;
    setHistory((h) => [...h, { index: i, value: solo.values[i], notes: solo.notes[i] }]);
    setSolo({
      ...solo,
      values,
      mistakes,
      status: mistakes >= MAX_MISTAKES ? "lost" : "playing",
      lostReason: mistakes >= MAX_MISTAKES ? "mistakes" : null,
    });
  };

  const soloErase = () => {
    if (!solo || solo.status !== "playing" || selected === null) return;
    const i = selected;
    if (solo.puzzle[i] !== 0 || solo.values[i] === solo.solution[i]) return;
    if (solo.values[i] === 0 && solo.notes[i] === 0) return;
    setHistory((h) => [...h, { index: i, value: solo.values[i], notes: solo.notes[i] }]);
    const values = [...solo.values];
    const notes = [...solo.notes];
    values[i] = 0;
    notes[i] = 0;
    setSolo({ ...solo, values, notes });
  };

  const soloUndo = () => {
    if (!solo || solo.status !== "playing" || history.length === 0) return;
    const last = history[history.length - 1];
    // Bỏ qua ô đã được điền đúng sau đó (đã khoá).
    if (solo.values[last.index] === solo.solution[last.index]) {
      setHistory((h) => h.slice(0, -1));
      return;
    }
    const values = [...solo.values];
    const notes = [...solo.notes];
    values[last.index] = last.value;
    notes[last.index] = last.notes;
    setSolo({ ...solo, values, notes });
    setSelected(last.index);
    setHistory((h) => h.slice(0, -1));
  };

  const soloHint = () => {
    if (!solo || solo.status !== "playing" || solo.hintsLeft <= 0) return;
    const i = pickHintCell(solo.values, solo.solution, selected);
    if (i === null) return;
    const n = solo.solution[i];
    const values = [...solo.values];
    values[i] = n;
    const notes = clearPeerNotes(solo.notes, i, n);
    sound.playStone();
    setSelected(i);
    if (isSolved(values, solo.solution)) {
      sound.playWin();
      setSolo({ ...solo, values, notes, hintsLeft: solo.hintsLeft - 1, status: "won" });
    } else {
      setSolo({ ...solo, values, notes, hintsLeft: solo.hintsLeft - 1 });
    }
  };

  // ================= ONLINE =================

  const roomRound = useRef<string | null>(null);
  const roomStatus = useRef<string | null>(null);
  const applyRoom = useCallback((next: SudokuOnlineState) => {
    setClockOffset(new Date(next.serverNow).getTime() - Date.now());
    if (next.startedAt !== roomRound.current) {
      // Ván mới: xoá ghi chú và ô sai của ván trước.
      roomRound.current = next.startedAt;
      setLocalEntries({});
      setOnlineNotes(new Array(CELLS).fill(0));
      setSelected(null);
      setHistory([]);
    }
    if (roomStatus.current === "PLAYING" && next.status === "FINISHED") {
      if (next.winner === next.mySide) sound.playWin();
      else sound.playTimeout();
    }
    roomStatus.current = next.status;
    setRoom(next);
  }, []);

  const handleCreateRoom = async () => {
    setBusy(true);
    setOnlineError(null);
    const res = await createSudokuRoom(difficulty, timerEnabled);
    setBusy(false);
    if (res.success && res.game) {
      setRoomCode(res.game.code);
      applyRoom(res.game);
    } else setOnlineError(res.error || "Không thể tạo phòng.");
  };

  const handleJoinRoom = useCallback(
    async (codeArg?: string) => {
      const code = (codeArg ?? roomInput).trim().toUpperCase();
      if (!code) return;
      setBusy(true);
      setOnlineError(null);
      const res = await joinSudokuRoom(code);
      setBusy(false);
      if (res.success && res.game) {
        setRoomCode(res.game.code);
        applyRoom(res.game);
      } else {
        setRoomCode(null);
        setOnlineError(res.error || "Không thể vào phòng.");
      }
    },
    [roomInput, applyRoom]
  );

  // Mở link mời: tự vào phòng một lần.
  const joinFromLink = useEffectEvent(() => {
    if (initialRoomCode) handleJoinRoom(initialRoomCode);
  });
  useEffect(() => {
    const id = setTimeout(() => joinFromLink(), 0);
    return () => clearTimeout(id);
  }, []);

  // Đồng bộ phòng mỗi 1.2 giây (giống Caro).
  useEffect(() => {
    if (mode !== "online" || !roomCode) return;
    let alive = true;
    const id = setInterval(async () => {
      const res = await getSudokuRoom(roomCode);
      if (alive && res.success && res.game) applyRoom(res.game);
    }, 1200);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mode, roomCode, applyRoom]);

  // Đồng hồ hiển thị cho ván online.
  const onlinePlaying = mode === "online" && room?.status === "PLAYING";
  useEffect(() => {
    if (!onlinePlaying) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [onlinePlaying]);

  const onlineElapsed =
    room?.startedAt && room.status === "PLAYING"
      ? Math.max(0, (now + clockOffset - new Date(room.startedAt).getTime()) / 1000)
      : 0;
  const onlineRemaining = room ? room.timeLimitSec - onlineElapsed : 0;

  const lastTick = useRef(-1);
  useEffect(() => {
    if (!onlinePlaying || !room?.timerEnabled) return;
    const sec = Math.ceil(onlineRemaining);
    if (sec <= 10 && sec > 0 && sec !== lastTick.current) {
      lastTick.current = sec;
      sound.playTick();
    }
  }, [onlinePlaying, onlineRemaining, room?.timerEnabled]);

  const onlineValues = useMemo(() => {
    const base = room?.myValues ?? room?.puzzle ?? EMPTY_GRID;
    const merged = [...base];
    for (const [k, entry] of Object.entries(localEntries)) {
      if (merged[Number(k)] === 0) merged[Number(k)] = entry.value;
    }
    return merged;
  }, [room?.myValues, room?.puzzle, localEntries]);

  const onlineInput = async (n: number) => {
    if (!room || !roomCode || room.status !== "PLAYING" || room.mySide === "SPECTATOR" || selected === null) return;
    const i = selected;
    const confirmed = room.myValues ?? room.puzzle;
    if (!confirmed || confirmed[i] !== 0) return;

    if (noteMode) {
      if (localEntries[i]) return;
      setHistory((h) => [...h, { index: i, value: 0, notes: onlineNotes[i] }]);
      setOnlineNotes((prev) => {
        const next = [...prev];
        next[i] ^= 1 << n;
        return next;
      });
      return;
    }
    if (localEntries[i]?.value === n) return;

    const prevEntry = localEntries[i];
    setLocalEntries((prev) => ({ ...prev, [i]: { value: n, wrong: false } }));
    const res = await submitSudokuCell(roomCode, i, n);
    if (!res.success || !res.game) {
      setLocalEntries((prev) => {
        const next = { ...prev };
        if (prevEntry) next[i] = prevEntry;
        else delete next[i];
        return next;
      });
      setOnlineError(res.error || "Không thể ghi nước đi.");
      return;
    }
    if (res.correct) {
      sound.playStone();
      setOnlineNotes((prev) => clearPeerNotes(prev, i, n));
      setLocalEntries((prev) => {
        const next = { ...prev };
        delete next[i];
        return next;
      });
    } else {
      sound.playTimeout();
      setHistory((h) => [...h, { index: i, value: prevEntry?.value ?? 0, notes: onlineNotes[i] }]);
      setLocalEntries((prev) => ({ ...prev, [i]: { value: n, wrong: true } }));
    }
    applyRoom(res.game);
  };

  const onlineErase = () => {
    if (selected === null || room?.status !== "PLAYING") return;
    const i = selected;
    if (!localEntries[i] && !onlineNotes[i]) return;
    setHistory((h) => [...h, { index: i, value: localEntries[i]?.value ?? 0, notes: onlineNotes[i] }]);
    setLocalEntries((prev) => {
      const next = { ...prev };
      delete next[i];
      return next;
    });
    setOnlineNotes((prev) => {
      const next = [...prev];
      next[i] = 0;
      return next;
    });
  };

  const onlineUndo = () => {
    if (history.length === 0 || room?.status !== "PLAYING") return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    if ((room.myValues ?? room.puzzle)?.[last.index] !== 0) return;
    setLocalEntries((prev) => {
      const next = { ...prev };
      if (last.value) next[last.index] = { value: last.value, wrong: true };
      else delete next[last.index];
      return next;
    });
    setOnlineNotes((prev) => {
      const next = [...prev];
      next[last.index] = last.notes;
      return next;
    });
    setSelected(last.index);
  };

  const handleStartRound = async () => {
    if (!roomCode) return;
    setBusy(true);
    const res = await startSudokuRound(roomCode);
    setBusy(false);
    if (res.success && res.game) applyRoom(res.game);
    else setOnlineError(res.error || "Không thể bắt đầu ván.");
  };

  const handleForfeit = async () => {
    if (!roomCode || !window.confirm("Bỏ cuộc ván này? Đối thủ sẽ được tính thắng.")) return;
    const res = await forfeitSudokuRound(roomCode);
    if (res.success && res.game) applyRoom(res.game);
  };

  const handleCopyLink = () => {
    if (!roomCode) return;
    navigator.clipboard.writeText(`${window.location.origin}/sudoku?room=${roomCode}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const leaveRoom = () => {
    setRoomCode(null);
    setRoom(null);
    setLocalEntries({});
    setOnlineNotes(new Array(CELLS).fill(0));
    setSelected(null);
    setHistory([]);
    window.history.replaceState(null, "", "/sudoku");
  };

  // ================= CÀI ĐẶT CHUNG =================

  const isHost = room?.mySide === "HOST";
  const canEditRoom = mode === "online" && !!room && isHost && room.status !== "PLAYING";

  const changeDifficulty = async (level: SudokuDifficulty) => {
    setDifficulty(level);
    if (mode === "solo") {
      // Đổi độ khó khi chưa có ván hoặc ván đã xong thì vào ván mới luôn.
      if (!solo || solo.status !== "playing") startSolo(level);
      return;
    }
    if (canEditRoom && roomCode) {
      const res = await updateSudokuRoomSettings(roomCode, level, room.timerEnabled);
      if (res.success && res.game) applyRoom(res.game);
    }
  };

  const toggleTimer = async () => {
    if (mode === "online") {
      if (!canEditRoom || !roomCode) return;
      const res = await updateSudokuRoomSettings(roomCode, room.difficulty, !room.timerEnabled);
      if (res.success && res.game) applyRoom(res.game);
      return;
    }
    const next = !timerEnabled;
    setTimerEnabled(next);
    writeStorage(STORAGE_TIMER, next);
    // Bật lại giữa ván: tính giờ từ lúc bật.
    if (next) setSolo((g) => (g ? { ...g, timerBase: g.elapsed } : g));
  };

  const handleToggleSound = () => setSoundOn(sound.toggle());

  const switchMode = (next: Mode) => {
    setMode(next);
    setSelected(null);
    setHistory([]);
    setNoteMode(false);
  };

  // ================= HIỂN THỊ =================

  const isOnline = mode === "online";
  const showOnlineBoard = isOnline && !!room;
  const activeTimer = isOnline ? !!room?.timerEnabled : timerEnabled;
  const activeDifficulty = isOnline && room ? room.difficulty : solo?.difficulty ?? difficulty;

  const puzzle = isOnline ? room?.puzzle ?? EMPTY_GRID : solo?.puzzle ?? EMPTY_GRID;
  const values = isOnline ? onlineValues : solo?.values ?? EMPTY_GRID;
  const notes = isOnline ? onlineNotes : solo?.notes ?? EMPTY_GRID;
  const wrong = useMemo(() => {
    if (isOnline) return Array.from({ length: CELLS }, (_, i) => !!localEntries[i]?.wrong);
    if (!solo) return new Array(CELLS).fill(false);
    return solo.values.map((v, i) => v !== 0 && v !== solo.solution[i]);
  }, [isOnline, localEntries, solo]);

  const playing = isOnline ? room?.status === "PLAYING" && room.mySide !== "SPECTATOR" : solo?.status === "playing";
  const mistakes = isOnline ? room?.myMistakes ?? 0 : solo?.mistakes ?? 0;
  const elapsed = isOnline ? onlineElapsed : solo?.elapsed ?? 0;
  const remaining = isOnline ? onlineRemaining : soloRemaining;
  const timeLimit = TIME_LIMIT_SEC[activeDifficulty];
  const clockText = activeTimer
    ? formatClock(playing ? remaining : isOnline ? room?.timeLimitSec ?? timeLimit : solo ? soloRemaining : timeLimit)
    : formatClock(elapsed);
  const lowTime = activeTimer && playing && remaining <= 60;

  // Mỗi số còn thiếu bao nhiêu (chỉ tính ô đúng).
  const remainingByDigit = useMemo(() => {
    const counts: Record<number, number> = {};
    for (let n = 1; n <= 9; n++) counts[n] = 9;
    const confirmed = isOnline
      ? room?.myValues ?? room?.puzzle ?? EMPTY_GRID
      : solo
      ? solo.values.map((v, i) => (v === solo.solution[i] ? v : 0))
      : EMPTY_GRID;
    for (const v of confirmed) if (v) counts[v]--;
    return counts;
  }, [isOnline, room?.myValues, room?.puzzle, solo]);

  const onInput = isOnline ? onlineInput : soloInput;
  const onErase = isOnline ? onlineErase : soloErase;
  const onUndo = isOnline ? onlineUndo : soloUndo;

  // Bàn phím: số 1–9, xoá, mũi tên, N = ghi chú, Ctrl/Cmd+Z = hoàn tác.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (!playing) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      onUndo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key)) {
      onInput(Number(e.key));
    } else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") {
      onErase();
    } else if (e.key === "n" || e.key === "N") {
      setNoteMode((v) => !v);
    } else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      setSelected((cur) => {
        const i = cur ?? 40;
        const r = rowOf(i);
        const c = colOf(i);
        if (e.key === "ArrowUp") return ((r + 8) % 9) * 9 + c;
        if (e.key === "ArrowDown") return ((r + 1) % 9) * 9 + c;
        if (e.key === "ArrowLeft") return r * 9 + ((c + 8) % 9);
        return r * 9 + ((c + 1) % 9);
      });
    }
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // Kết quả ván
  let resultTitle: string | null = null;
  let resultText = "";
  let resultWin = false;
  if (!isOnline && solo && solo.status !== "playing") {
    resultWin = solo.status === "won";
    resultTitle = resultWin ? "Giải xong rồi!" : solo.lostReason === "timeout" ? "Hết giờ" : "Sai quá 3 lần";
    resultText = resultWin
      ? `Bạn giải đề ${DIFFICULTY_LABEL[solo.difficulty]} trong ${formatClock(solo.elapsed)}${
          best[solo.difficulty] === solo.elapsed ? " · Kỷ lục mới của bạn" : ""
        }.`
      : "Đừng nản, thử một đề mới nhé.";
  }
  if (isOnline && room?.status === "FINISHED" && room.winner) {
    const opponentName = room.mySide === "HOST" ? room.guestName : room.hostName;
    const winnerName = room.winner === "HOST" ? room.hostName : room.winner === "GUEST" ? room.guestName : null;
    resultWin = room.winner === room.mySide;
    if (room.winner === "DRAW") {
      resultTitle = "Hoà";
      resultText = "Hết giờ, hai bên giải được số ô bằng nhau.";
    } else {
      resultTitle = room.mySide === "SPECTATOR" ? `${winnerName} thắng` : resultWin ? "Bạn thắng!" : `${opponentName} thắng`;
      const loserName = room.winner === "HOST" ? room.guestName : room.hostName;
      resultText =
        room.finishReason === "SOLVED"
          ? `${winnerName} giải xong trước.`
          : room.finishReason === "TIMEOUT"
          ? `${winnerName} giải được nhiều ô hơn khi hết giờ.`
          : room.finishReason === "FORFEIT"
          ? `${loserName} đã bỏ cuộc.`
          : `${loserName} sai quá 3 lần.`;
    }
  }

  const pillBase =
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150";

  return (
    <div className="mx-auto max-w-5xl px-3 py-6 font-sans sm:px-6 sm:py-8">
      {/* Điều hướng và tiện ích */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="group inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 transition-colors hover:text-zinc-950"
        >
          <ArrowLeft size={16} className="transition-transform duration-150 group-hover:-translate-x-0.5" />
          <span>Trang chủ myCreative</span>
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTimer}
            disabled={isOnline && !canEditRoom}
            title={
              isOnline && !canEditRoom
                ? "Chủ phòng chọn đếm giờ trước khi bắt đầu ván"
                : `Bật/Tắt giới hạn thời gian (${DIFFICULTY_LABEL[activeDifficulty]}: ${timeLimit / 60} phút)`
            }
            className={`${pillBase} shadow-xs disabled:cursor-not-allowed disabled:opacity-60 ${
              activeTimer
                ? "border-amber-300 bg-amber-50/80 text-amber-900"
                : "border-zinc-200 bg-white text-zinc-500 hover:text-zinc-800"
            }`}
          >
            <TimerIcon size={14} className={activeTimer ? "text-amber-600" : "text-zinc-400"} />
            <span>{activeTimer ? `Đếm giờ: ${timeLimit / 60} phút` : "Đếm giờ: Tắt"}</span>
          </button>

          <button
            type="button"
            onClick={handleToggleSound}
            className={`${pillBase} border-zinc-200 bg-white text-zinc-600 shadow-xs hover:border-zinc-300 hover:text-zinc-950`}
            title={soundOn ? "Tắt âm thanh" : "Bật âm thanh"}
          >
            {soundOn ? <Volume2 size={15} className="text-lime-600" /> : <VolumeX size={15} className="text-zinc-400" />}
            <span>{soundOn ? "Âm thanh: Bật" : "Âm thanh: Tắt"}</span>
          </button>
        </div>
      </div>

      {/* Tiêu đề và chế độ */}
      <div className="mb-6 text-center">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-brand-100/70 px-3 py-0.5 text-xs font-semibold text-brand-900">
          <Sparkles size={13} className="text-brand-700" />
          <span>Góc Giải Trí Creative</span>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-zinc-950 sm:text-3xl">Sudoku 9x9</h1>

        <div className="mt-4 inline-flex rounded-full border border-zinc-200 bg-zinc-100/80 p-1 shadow-xs">
          {(
            [
              ["solo", "Chơi một mình", User],
              ["online", "Thi đấu online", Globe],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => switchMode(key)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-150 ${
                mode === key ? "bg-white text-zinc-950 shadow-xs" : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              <Icon size={14} className={mode === key ? "text-brand-600" : ""} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tạo / vào phòng online */}
      {isOnline && !roomCode && (
        <div className="mx-auto mb-6 max-w-md rounded-[16px] border border-zinc-200 bg-white p-5 text-center shadow-xs">
          <h2 className="mb-4 text-sm font-bold text-zinc-900">Phòng thi đấu</h2>

          {onlineError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs font-medium text-red-600">
              {onlineError}
            </div>
          )}

          <div className="mb-3 flex flex-wrap justify-center gap-1.5">
            {DIFFICULTIES.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setDifficulty(level)}
                className={`${pillBase} ${
                  difficulty === level
                    ? "border-brand-300 bg-brand-50 text-brand-900"
                    : "border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900"
                }`}
              >
                {DIFFICULTY_LABEL[level]}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <button
              type="button"
              disabled={busy}
              onClick={handleCreateRoom}
              className="w-full rounded-[10px] bg-brand-400 py-2.5 text-xs font-semibold text-zinc-950 shadow-xs transition-all duration-150 hover:-translate-y-0.5 hover:bg-brand-500 disabled:opacity-50"
            >
              {busy ? "Đang tạo phòng..." : `Tạo phòng · ${DIFFICULTY_LABEL[difficulty]}${timerEnabled ? ` · ${TIME_LIMIT_SEC[difficulty] / 60} phút` : " · Không giới hạn giờ"}`}
            </button>

            <div className="relative flex items-center justify-center py-1">
              <span className="w-full border-t border-zinc-200" />
              <span className="absolute bg-white px-2 text-[11px] font-medium text-zinc-400">HOẶC</span>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Nhập mã phòng (VD: SD8X9K)"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
                className="flex-1 rounded-[10px] border border-zinc-200 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-900 focus:border-brand-500 focus:outline-none"
              />
              <button
                type="button"
                disabled={busy || !roomInput.trim()}
                onClick={() => handleJoinRoom()}
                className="rounded-[10px] bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-40"
              >
                Vào phòng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thông tin phòng online */}
      {showOnlineBoard && room && (
        <div className="mx-auto mb-4 max-w-3xl rounded-[14px] border border-brand-200 bg-brand-50/60 p-3 text-xs shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-zinc-500">Mã phòng: </span>
              <strong className="text-sm font-bold tracking-wide text-zinc-950">{room.code}</strong>
              <span className="ml-2 text-zinc-500">
                {DIFFICULTY_LABEL[room.difficulty]} ·{" "}
                {room.timerEnabled ? `${room.timeLimitSec / 60} phút` : "không giới hạn giờ"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-xs hover:border-zinc-300"
              >
                {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                <span>{copied ? "Đã chép link" : "Mời bạn"}</span>
              </button>
              {room.status === "PLAYING" && room.mySide !== "SPECTATOR" && (
                <button
                  type="button"
                  onClick={handleForfeit}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:text-red-600"
                >
                  <Flag size={12} />
                  <span>Bỏ cuộc</span>
                </button>
              )}
              <button
                type="button"
                onClick={leaveRoom}
                className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-800"
              >
                Rời phòng
              </button>
            </div>
          </div>

          {/* Tiến độ hai bên */}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(["HOST", "GUEST"] as const).map((side) => {
              const name = side === "HOST" ? room.hostName : room.guestName;
              const progress = side === "HOST" ? room.hostProgress : room.guestProgress;
              const clues = room.puzzle ? room.puzzle.filter(Boolean).length : 0;
              const pct = room.puzzle ? Math.round(((progress - clues) / Math.max(1, CELLS - clues)) * 100) : 0;
              const sideMistakes =
                room.mySide === side ? room.myMistakes : room.mySide === "SPECTATOR" ? null : room.opponentMistakes;
              const score = side === "HOST" ? room.scoreHost : room.scoreGuest;
              return (
                <div key={side} className="rounded-[10px] bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-zinc-900">
                      {name ?? "Đang chờ đối thủ..."}
                      {room.mySide === side && <span className="ml-1 font-normal text-zinc-400">(bạn)</span>}
                    </span>
                    <span className="shrink-0 text-[11px] text-zinc-500">
                      {score} thắng
                      {sideMistakes !== null && room.status !== "WAITING" && ` · ${sideMistakes}/${MAX_MISTAKES} lỗi`}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full origin-left rounded-full bg-brand-500 transition-transform duration-200"
                      style={{ transform: `scaleX(${Math.max(0, Math.min(100, pct)) / 100})` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {canEditRoom && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] text-zinc-500">Độ khó</span>
              {DIFFICULTIES.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => changeDifficulty(level)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                    room.difficulty === level
                      ? "border-brand-300 bg-white text-brand-900"
                      : "border-transparent text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  {DIFFICULTY_LABEL[level]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isOnline && roomCode && onlineError && (
        <div className="mx-auto mb-3 flex max-w-3xl items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900">
          <AlertCircle size={15} className="shrink-0 text-amber-600" />
          <span>{onlineError}</span>
          <button type="button" onClick={() => setOnlineError(null)} className="ml-auto text-amber-700 hover:text-amber-900">
            Đóng
          </button>
        </div>
      )}

      {(!isOnline || showOnlineBoard) && (
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 lg:flex-row lg:items-start lg:justify-center">
          {/* Bàn cờ */}
          <div className="relative w-full max-w-[460px]">
            <SudokuBoard
              puzzle={puzzle}
              values={values}
              wrong={wrong}
              notes={notes}
              selected={playing ? selected : null}
              disabled={!playing}
              hidden={isOnline ? room?.status !== "PLAYING" && room?.status !== "FINISHED" : !solo}
              onSelect={setSelected}
            />

            {/* Lớp phủ: chưa bắt đầu / chờ đối thủ / kết quả */}
            {(() => {
              let content: React.ReactNode = null;
              if (!isOnline && !solo) {
                content = (
                  <>
                    <h3 className="mb-3 text-base font-extrabold text-zinc-950">Sẵn sàng giải đố?</h3>
                    <div className="mb-4 flex flex-wrap justify-center gap-1.5">
                      {DIFFICULTIES.map((level) => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => setDifficulty(level)}
                          className={`${pillBase} ${
                            difficulty === level
                              ? "border-brand-300 bg-brand-50 text-brand-900"
                              : "border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900"
                          }`}
                        >
                          {DIFFICULTY_LABEL[level]}
                        </button>
                      ))}
                    </div>
                    <OverlayButton onClick={() => startSolo()} icon={<Play size={14} className="fill-zinc-950" />}>
                      Bắt đầu
                    </OverlayButton>
                  </>
                );
              } else if (isOnline && room?.status === "WAITING") {
                content = (
                  <>
                    <h3 className="mb-4 text-base font-extrabold text-zinc-950">Đang chờ đối thủ</h3>
                    <OverlayButton onClick={handleCopyLink} icon={copied ? <Check size={14} /> : <Copy size={14} />}>
                      {copied ? "Đã chép link" : "Chép link mời"}
                    </OverlayButton>
                  </>
                );
              } else if (isOnline && room?.status === "READY") {
                content = (
                  <>
                    <h3 className="text-base font-extrabold text-zinc-950">Đã đủ 2 người!</h3>
                    <p className="mb-4 mt-1 text-xs text-zinc-500">
                      {room.hostName} vs {room.guestName}
                    </p>
                    {room.mySide !== "SPECTATOR" && (
                      <OverlayButton onClick={handleStartRound} disabled={busy} icon={<Play size={14} className="fill-zinc-950" />}>
                        Bắt đầu ván đấu
                      </OverlayButton>
                    )}
                  </>
                );
              } else if (resultTitle) {
                content = (
                  <>
                    <div
                      className={`mx-auto mb-2.5 flex h-12 w-12 items-center justify-center rounded-full ${
                        resultWin ? "bg-brand-100 text-brand-700" : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {resultWin ? <Trophy size={22} /> : <AlertCircle size={22} />}
                    </div>
                    <h3 className="text-base font-extrabold text-zinc-950">{resultTitle}</h3>
                    <p className="mb-4 mt-1 text-xs text-zinc-500">{resultText}</p>
                    {isOnline ? (
                      room?.mySide !== "SPECTATOR" && (
                        <OverlayButton onClick={handleStartRound} disabled={busy} icon={<RotateCcw size={14} />}>
                          Ván mới
                        </OverlayButton>
                      )
                    ) : (
                      <OverlayButton onClick={() => startSolo(solo!.difficulty)} icon={<RotateCcw size={14} />}>
                        Ván mới
                      </OverlayButton>
                    )}
                  </>
                );
              }
              if (!content) return null;
              return (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[14px] bg-stone-900/10 p-4 text-center backdrop-blur-[1.5px]">
                  <div className="w-full max-w-xs rounded-[18px] border border-zinc-200 bg-white p-5 shadow-xl sm:p-6">
                    {content}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Bảng điều khiển */}
          <div className="flex w-full max-w-[460px] flex-col gap-3 lg:w-[260px]">
            <div className="grid grid-cols-3 gap-2">
              <Stat label={activeTimer ? "Còn lại" : "Thời gian"} value={clockText} danger={lowTime} />
              <Stat label="Lỗi sai" value={`${mistakes}/${MAX_MISTAKES}`} danger={mistakes >= MAX_MISTAKES - 1 && !!playing} />
              {isOnline ? (
                <Stat label="Độ khó" value={DIFFICULTY_LABEL[activeDifficulty]} small />
              ) : (
                <Stat label="Gợi ý" value={`${solo?.hintsLeft ?? MAX_HINTS}`} />
              )}
            </div>

            <div className={`grid gap-2 ${isOnline ? "grid-cols-3" : "grid-cols-4"}`}>
              <ToolButton label="Hoàn tác" onClick={onUndo} disabled={!playing}>
                <Undo2 size={18} />
              </ToolButton>
              <ToolButton label="Xoá" onClick={onErase} disabled={!playing}>
                <Eraser size={18} />
              </ToolButton>
              <ToolButton label={noteMode ? "Ghi chú: Bật" : "Ghi chú"} onClick={() => setNoteMode((v) => !v)} active={noteMode} disabled={!playing}>
                <Pencil size={18} />
              </ToolButton>
              {!isOnline && (
                <ToolButton label="Gợi ý" onClick={soloHint} disabled={!playing || (solo?.hintsLeft ?? 0) <= 0}>
                  <Lightbulb size={18} />
                </ToolButton>
              )}
            </div>

            <div className="grid grid-cols-9 gap-1.5 lg:grid-cols-3 lg:gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
                const left = remainingByDigit[n];
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onInput(n)}
                    disabled={!playing || left <= 0}
                    aria-label={`Điền số ${n}, còn ${left}`}
                    className="flex h-12 flex-col items-center justify-center rounded-[12px] border border-zinc-200 bg-white text-lg font-semibold text-zinc-900 shadow-xs transition-all duration-150 hover:-translate-y-0.5 hover:border-brand-300 disabled:translate-y-0 disabled:opacity-35 lg:h-14 lg:text-xl"
                  >
                    {n}
                    <span className="text-[10px] font-medium leading-none text-zinc-400">{left > 0 ? left : ""}</span>
                  </button>
                );
              })}
            </div>

            {!isOnline && solo && (
              <button
                type="button"
                onClick={() => {
                  if (solo.status !== "playing" || window.confirm("Bỏ ván đang chơi và bắt đầu đề mới?")) startSolo();
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-brand-400 px-3.5 py-2 text-xs font-semibold text-zinc-950 shadow-xs transition-all duration-150 hover:-translate-y-0.5 hover:bg-brand-500"
              >
                <RotateCcw size={14} />
                <span>Ván mới · {DIFFICULTY_LABEL[difficulty]}</span>
              </button>
            )}

            {!isOnline && (
              <div className="flex flex-wrap gap-1.5">
                {DIFFICULTIES.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => changeDifficulty(level)}
                    title={solo?.status === "playing" ? "Áp dụng cho ván mới" : undefined}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      difficulty === level
                        ? "border-brand-300 bg-brand-50 text-brand-900"
                        : "border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900"
                    }`}
                  >
                    {DIFFICULTY_LABEL[level]}
                    {best[level] !== undefined && (
                      <span className="ml-1 text-zinc-400">· {formatClock(best[level]!)}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <GameLeaderboard game="sudoku" refreshKey={room?.status === "FINISHED" ? `${room.code}-${room.scoreHost}-${room.scoreGuest}` : null} />
    </div>
  );
}

function Stat({ label, value, danger = false, small = false }: { label: string; value: string; danger?: boolean; small?: boolean }) {
  return (
    <div className="rounded-[12px] border border-zinc-200 bg-white px-3 py-2 shadow-xs">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div
        className={`font-mono font-bold tabular-nums ${small ? "font-sans text-sm" : "text-lg"} ${
          danger ? "text-red-600" : "text-zinc-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className="group flex flex-col items-center gap-1 text-[11px] font-medium text-zinc-500 disabled:opacity-40"
    >
      <span
        className={`flex h-11 w-full items-center justify-center rounded-[12px] border shadow-xs transition-all duration-150 group-enabled:group-hover:-translate-y-0.5 ${
          active ? "border-brand-300 bg-brand-50 text-brand-800" : "border-zinc-200 bg-white text-zinc-700"
        }`}
      >
        {children}
      </span>
      {label}
    </button>
  );
}

function OverlayButton({
  onClick,
  disabled,
  icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-brand-400 py-2.5 text-xs font-bold text-zinc-950 shadow-xs transition-all duration-150 hover:-translate-y-0.5 hover:bg-brand-500 disabled:opacity-50"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
