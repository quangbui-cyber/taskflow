"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  createEmptyBoard,
  checkWin,
  isBoardFull,
  getAiMove,
  type Board,
  type Player,
  type Point,
} from "@/lib/caro";
import { caroSound } from "@/lib/caroSound";
import CaroBoard from "./CaroBoard";
import {
  createOnlineGame,
  joinOnlineGame,
  getOnlineGame,
  makeOnlineMove,
  resetOnlineGame,
  handleOnlineTimeout,
  type OnlineGameState,
} from "@/app/actions/caroOnline";
import {
  Bot,
  Copy,
  Check,
  RotateCcw,
  Volume2,
  VolumeX,
  Globe,
  Sparkles,
  Trophy,
  ArrowLeft,
  Timer as TimerIcon,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";

type GameMode = "ai" | "online";
type AiDifficulty = "easy" | "hard";

interface CaroGameProps {
  initialRoomCode?: string | null;
  currentUserName?: string;
}

export default function CaroGame({ initialRoomCode = null, currentUserName = "Tôi" }: CaroGameProps) {
  // Chỉ có 2 chế độ: "ai" (Chơi với máy) và "online" (Chơi online)
  const [mode, setMode] = useState<GameMode>(initialRoomCode ? "online" : "ai");
  const [difficulty, setDifficulty] = useState<AiDifficulty>("hard");
  const [soundOn, setSoundOn] = useState(true);

  // Chế độ đếm giờ 15s mỗi lượt
  const [timerEnabled, setTimerEnabled] = useState(true);
  const [timeLeft, setTimeLeft] = useState(15);
  const [timeoutMessage, setTimeoutMessage] = useState<string | null>(null);

  // Local AI state
  const [board, setBoard] = useState<Board>(createEmptyBoard);
  const [currentTurn, setCurrentTurn] = useState<Player>("X");
  const [lastMove, setLastMove] = useState<Point | null>(null);
  const [winner, setWinner] = useState<Player | "DRAW" | null>(null);
  const [winningLine, setWinningLine] = useState<Point[]>([]);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [moveHistory, setMoveHistory] = useState<{ r: number; c: number; player: Player }[]>([]);

  // Lưu người thắng ván trước để người thua được đi trước ở ván kế tiếp
  const [lastWinner, setLastWinner] = useState<Player | "DRAW" | null>(null);
  const [turnReason, setTurnReason] = useState<string>("");

  // Tỉ số local
  const [scoreX, setScoreX] = useState(0);
  const [scoreO, setScoreO] = useState(0);

  // Online state
  const [onlineRoomCode, setOnlineRoomCode] = useState<string | null>(initialRoomCode);
  const [onlineGame, setOnlineGame] = useState<OnlineGameState | null>(null);
  const [myRole, setMyRole] = useState<Player | null>(null);
  const [roomInput, setRoomInput] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);

  // Khởi tạo âm thanh
  useEffect(() => {
    setSoundOn(caroSound.isEnabled());
  }, []);

  const handleToggleSound = () => {
    const next = caroSound.toggle();
    setSoundOn(next);
  };

  // Khởi tạo ngẫu nhiên người đi đầu ở ván đầu tiên khi đấu với máy
  useEffect(() => {
    const aiFirst = Math.random() < 0.5;
    if (aiFirst) {
      setTurnReason("🎲 Bốc thăm ván đầu: Máy được đi trước!");
      setCurrentTurn("O");
      setIsAiThinking(true);
      const timer = setTimeout(() => {
        const empty = createEmptyBoard();
        const aiMove = getAiMove(empty, "O", difficulty) || { r: 7, c: 7 };
        empty[aiMove.r][aiMove.c] = "O";
        setBoard(empty);
        setLastMove(aiMove);
        setMoveHistory([{ r: aiMove.r, c: aiMove.c, player: "O" }]);
        setCurrentTurn("X");
        setIsAiThinking(false);
        caroSound.playStone();
      }, 400);
      return () => clearTimeout(timer);
    } else {
      setTurnReason("🎲 Bốc thăm ván đầu: Bạn được đi trước!");
      setCurrentTurn("X");
    }
  }, [difficulty]);

  // Bắt đầu ván mới với AI (người thua ván trước được quyền đi trước)
  const handleResetAi = useCallback(() => {
    const empty = createEmptyBoard();
    setBoard(empty);
    setLastMove(null);
    setWinner(null);
    setWinningLine([]);
    setMoveHistory([]);
    setIsAiThinking(false);
    setTimeLeft(15);
    setTimeoutMessage(null);

    // Quy tắc: Nếu thua thì sẽ được đi trước.
    // Nếu ván đầu hoặc hòa: Bốc thăm ngẫu nhiên 50/50.
    let aiGoesFirst = false;
    let reason = "";

    if (lastWinner === "X") {
      // Bạn (X) thắng ván trước -> Máy (O) thua -> Máy được đi trước
      aiGoesFirst = true;
      reason = "🔄 Máy thua ván trước ➔ Máy được quyền đi trước ván này!";
    } else if (lastWinner === "O") {
      // Máy (O) thắng ván trước -> Bạn (X) thua -> Bạn được đi trước
      aiGoesFirst = false;
      reason = "🔄 Bạn thua ván trước ➔ Bạn được quyền đi trước ván này!";
    } else {
      aiGoesFirst = Math.random() < 0.5;
      reason = aiGoesFirst
        ? "🎲 Bốc thăm ngẫu nhiên: Máy đi trước!"
        : "🎲 Bốc thăm ngẫu nhiên: Bạn đi trước!";
    }

    setTurnReason(reason);

    if (aiGoesFirst) {
      setCurrentTurn("O");
      setIsAiThinking(true);
      setTimeout(() => {
        const newEmpty = createEmptyBoard();
        const aiMove = getAiMove(newEmpty, "O", difficulty) || { r: 7, c: 7 };
        newEmpty[aiMove.r][aiMove.c] = "O";
        setBoard(newEmpty);
        setLastMove(aiMove);
        setMoveHistory([{ r: aiMove.r, c: aiMove.c, player: "O" }]);
        setCurrentTurn("X");
        setIsAiThinking(false);
        caroSound.playStone();
      }, 350);
    } else {
      setCurrentTurn("X");
    }
  }, [difficulty, lastWinner]);

  // Xử lý nước đi người chơi ở chế độ AI
  const handleLocalCellClick = useCallback(
    (r: number, c: number) => {
      if (winner || board[r][c] !== null || isAiThinking || currentTurn !== "X") return;

      caroSound.playStone();
      setTimeLeft(15);
      setTimeoutMessage(null);

      const newBoard = board.map((row) => [...row]);
      newBoard[r][c] = "X";
      const move = { r, c };
      setBoard(newBoard);
      setLastMove(move);
      setMoveHistory((prev) => [...prev, { r, c, player: "X" }]);

      const winResult = checkWin(newBoard, r, c, "X");
      if (winResult.won) {
        setWinner("X");
        setLastWinner("X");
        setWinningLine(winResult.line);
        caroSound.playWin();
        setScoreX((s) => s + 1);
        return;
      }

      if (isBoardFull(newBoard)) {
        setWinner("DRAW");
        setLastWinner("DRAW");
        return;
      }

      // Chuyển lượt sang Máy (O)
      setCurrentTurn("O");
      setIsAiThinking(true);

      setTimeout(() => {
        const aiMove = getAiMove(newBoard, "O", difficulty);
        if (aiMove) {
          caroSound.playStone();
          const aiBoard = newBoard.map((row) => [...row]);
          aiBoard[aiMove.r][aiMove.c] = "O";
          setBoard(aiBoard);
          setLastMove(aiMove);
          setMoveHistory((prev) => [...prev, { r: aiMove.r, c: aiMove.c, player: "O" }]);

          const aiWin = checkWin(aiBoard, aiMove.r, aiMove.c, "O");
          if (aiWin.won) {
            setWinner("O");
            setLastWinner("O");
            setWinningLine(aiWin.line);
            caroSound.playWin();
            setScoreO((s) => s + 1);
          } else if (isBoardFull(aiBoard)) {
            setWinner("DRAW");
            setLastWinner("DRAW");
          } else {
            setCurrentTurn("X");
            setTimeLeft(15);
          }
        }
        setIsAiThinking(false);
      }, 320);
    },
    [board, currentTurn, difficulty, isAiThinking, winner]
  );

  // Đi lại (Undo) khi đấu với AI
  const handleUndo = () => {
    if (moveHistory.length < 2 || isAiThinking || winner) return;

    // Bỏ 2 nước (nước AI và nước người chơi)
    const newHistory = moveHistory.slice(0, -2);
    const newBoard = createEmptyBoard();
    newHistory.forEach((m) => {
      newBoard[m.r][m.c] = m.player;
    });
    setBoard(newBoard);
    setMoveHistory(newHistory);
    setLastMove(newHistory.length > 0 ? { r: newHistory[newHistory.length - 1].r, c: newHistory[newHistory.length - 1].c } : null);
    setCurrentTurn("X");
    setWinner(null);
    setWinningLine([]);
    setTimeLeft(15);
    setTimeoutMessage(null);
  };

  // --- ONLINE MULTIPLAYER LOGIC ---
  const handleCreateRoom = async () => {
    setIsJoining(true);
    setOnlineError(null);
    setTimeoutMessage(null);
    const res = await createOnlineGame(currentUserName);
    setIsJoining(false);
    if (res.success && res.game) {
      setOnlineRoomCode(res.game.code);
      setOnlineGame(res.game);
      setMyRole("X");
      setTimeLeft(15);
    } else {
      setOnlineError(res.error || "Không thể tạo phòng.");
    }
  };

  const handleJoinRoom = async (codeToJoin?: string) => {
    const code = (codeToJoin || roomInput).trim().toUpperCase();
    if (!code) return;
    setIsJoining(true);
    setOnlineError(null);
    setTimeoutMessage(null);
    const res = await joinOnlineGame(code, currentUserName);
    setIsJoining(false);
    if (res.success && res.game) {
      setOnlineRoomCode(res.game.code);
      setOnlineGame(res.game);
      setMyRole(res.role || "O");
      setTimeLeft(15);
    } else {
      setOnlineError(res.error || "Không thể vào phòng.");
    }
  };

  // Tự động vào phòng nếu có initialRoomCode trong URL
  useEffect(() => {
    if (initialRoomCode && !onlineGame) {
      handleJoinRoom(initialRoomCode);
    }
  }, [initialRoomCode]);

  // Polling đồng bộ phòng Online mỗi 1.2s
  useEffect(() => {
    if (mode !== "online" || !onlineRoomCode) return;

    let isMounted = true;
    const interval = setInterval(async () => {
      const res = await getOnlineGame(onlineRoomCode);
      if (isMounted && res.success && res.game) {
        // Kiểm tra xem có nước đi mới không
        if (
          onlineGame &&
          res.game.lastMove &&
          (!onlineGame.lastMove ||
            onlineGame.lastMove.r !== res.game.lastMove.r ||
            onlineGame.lastMove.c !== res.game.lastMove.c)
        ) {
          caroSound.playStone();
          setTimeLeft(15);
          setTimeoutMessage(null);
          if (res.game.winner && res.game.winner !== "DRAW") {
            caroSound.playWin();
          }
        }
        setOnlineGame(res.game);
      }
    }, 1200);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [mode, onlineRoomCode, onlineGame]);

  const handleOnlineCellClick = async (r: number, c: number) => {
    if (!onlineGame || !onlineRoomCode || !myRole) return;
    if (onlineGame.status !== "PLAYING") return;
    if (onlineGame.turn !== myRole) return;

    caroSound.playStone();
    setTimeLeft(15);
    setTimeoutMessage(null);
    const res = await makeOnlineMove(onlineRoomCode, r, c, myRole);
    if (res.success && res.game) {
      setOnlineGame(res.game);
      if (res.game.winner && res.game.winner !== "DRAW") {
        caroSound.playWin();
      }
    } else if (res.error) {
      alert(res.error);
    }
  };

  const handleOnlineReset = async () => {
    if (!onlineRoomCode) return;
    const res = await resetOnlineGame(onlineRoomCode);
    if (res.success && res.game) {
      setOnlineGame(res.game);
      setTimeLeft(15);
      setTimeoutMessage(null);
    }
  };

  const handleCopyLink = () => {
    if (!onlineRoomCode) return;
    const url = `${window.location.origin}/caro?room=${onlineRoomCode}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Trạng thái hiển thị lượt chơi và người thắng
  const isOnlineActive = mode === "online" && !!onlineGame;
  const currentBoard = isOnlineActive ? onlineGame.board : board;
  const currentLastMove = isOnlineActive ? onlineGame.lastMove : lastMove;
  const currentWinningLine = isOnlineActive ? onlineGame.winningLine : winningLine;
  const activeWinner = isOnlineActive ? onlineGame.winner : winner;
  const activeTurn = isOnlineActive ? onlineGame.turn : currentTurn;

  // Biểu tượng khi hover: Ai nắm X thấy X, ai nắm O thấy O
  const effectiveHoverSymbol: Player = isOnlineActive ? (myRole || "X") : "X";

  // Reset đếm giờ 15s mỗi khi đổi lượt hoặc có nước đi mới
  useEffect(() => {
    setTimeLeft(15);
  }, [activeTurn, currentLastMove]);

  // Bộ đếm ngược 15s
  useEffect(() => {
    if (!timerEnabled || activeWinner) return;
    if (mode === "online" && (!onlineGame || onlineGame.status !== "PLAYING")) return;
    if (mode === "ai" && isAiThinking) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          return 0;
        }
        if (prev <= 6) {
          caroSound.playTick();
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timerEnabled, activeWinner, mode, onlineGame?.status, activeTurn, isAiThinking]);

  // Xử lý khi hết 15 giây (xử thua do hết giờ)
  useEffect(() => {
    if (!timerEnabled || timeLeft !== 0 || activeWinner) return;

    caroSound.playTimeout();

    if (mode === "ai") {
      if (currentTurn === "X") {
        setWinner("O");
        setLastWinner("O");
        setScoreO((s) => s + 1);
        setTimeoutMessage("⏳ Hết 15 giây! Bạn bị xử thua do quá thời gian lượt đi.");
      } else {
        setWinner("X");
        setLastWinner("X");
        setScoreX((s) => s + 1);
        setTimeoutMessage("⏳ Máy hết thời gian suy nghĩ! Bạn giành chiến thắng.");
      }
    } else if (mode === "online" && onlineRoomCode && onlineGame?.status === "PLAYING") {
      const timedOutPlayer = onlineGame.turn;
      handleOnlineTimeout(onlineRoomCode, timedOutPlayer).then((res) => {
        if (res.success && res.game) {
          setOnlineGame(res.game);
          const loser = timedOutPlayer === "X" ? res.game.playerXName : res.game.playerOName;
          setTimeoutMessage(`⏳ Hết 15 giây! ${loser} bị xử thua do quá thời gian.`);
        }
      });
    }
  }, [timeLeft, timerEnabled, activeWinner, mode, currentTurn, onlineGame, onlineRoomCode]);

  return (
    <div className="mx-auto max-w-4xl px-3 sm:px-6 py-6 sm:py-8 font-sans">
      {/* Thanh Header điều hướng & Tiện ích */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="group inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 transition-colors hover:text-zinc-950"
        >
          <ArrowLeft size={16} className="transition-transform duration-150 group-hover:-translate-x-0.5" />
          <span>Trang chủ myCreative</span>
        </Link>

        <div className="flex items-center gap-2">
          {/* Nút Bật/Tắt chế độ đếm giờ 15s */}
          <button
            type="button"
            onClick={() => {
              setTimerEnabled((t) => !t);
              setTimeLeft(15);
              setTimeoutMessage(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-xs transition-colors ${
              timerEnabled
                ? "border-amber-300 bg-amber-50/80 text-amber-900"
                : "border-zinc-200 bg-white text-zinc-500 hover:text-zinc-800"
            }`}
            title="Bật/Tắt đếm giờ 15s mỗi lượt"
          >
            <TimerIcon size={14} className={timerEnabled ? "text-amber-600" : "text-zinc-400"} />
            <span>{timerEnabled ? "Đếm giờ: 15s/lượt" : "Đếm giờ: Tắt"}</span>
          </button>

          {/* Nút bật/tắt âm thanh */}
          <button
            type="button"
            onClick={handleToggleSound}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 shadow-xs transition-colors hover:border-zinc-300 hover:text-zinc-950"
            title={soundOn ? "Tắt âm thanh cờ" : "Bật âm thanh cờ"}
          >
            {soundOn ? <Volume2 size={15} className="text-lime-600" /> : <VolumeX size={15} className="text-zinc-400" />}
            <span>{soundOn ? "Âm thanh: Bật" : "Âm thanh: Tắt"}</span>
          </button>
        </div>
      </div>

      {/* Tiêu đề & Chọn 2 chế độ chơi */}
      <div className="mb-6 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-100/70 px-3 py-0.5 text-xs font-semibold text-brand-900 mb-2">
          <Sparkles size={13} className="text-brand-700" />
          <span>Góc Giải Trí Creative</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-950">
          Cờ Caro 15x15
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-zinc-500">
          5 quân liên tiếp · Đếm giờ 15s mỗi lượt · Người thua ván trước được đi trước
        </p>

        {/* Thanh chọn 2 chế độ duy nhất */}
        <div className="mt-4 inline-flex rounded-full border border-zinc-200 bg-zinc-100/80 p-1 shadow-xs">
          <button
            type="button"
            onClick={() => {
              setMode("ai");
              handleResetAi();
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-150 ${
              mode === "ai" ? "bg-white text-zinc-950 shadow-xs" : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            <Bot size={14} className={mode === "ai" ? "text-brand-600" : ""} />
            <span>Chơi với Máy</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("online");
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-150 ${
              mode === "online" ? "bg-white text-zinc-950 shadow-xs" : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            <Globe size={14} className={mode === "online" ? "text-brand-600" : ""} />
            <span>Chơi Online</span>
          </button>
        </div>
      </div>

      {/* KHU VỰC TẠO PHÒNG / VÀO PHÒNG ONLINE */}
      {mode === "online" && !onlineRoomCode && (
        <div className="mb-6 mx-auto max-w-md rounded-[16px] border border-zinc-200 bg-white p-5 shadow-xs text-center">
          <h2 className="text-sm font-bold text-zinc-900 mb-1">Thách đấu đồng nghiệp qua mạng</h2>
          <p className="text-xs text-zinc-500 mb-4">
            Tạo phòng và gửi link cho bạn bè, hoặc nhập mã phòng để vào đối đầu.
          </p>

          {onlineError && (
            <div className="mb-3 rounded-lg bg-red-50 p-2 text-xs font-medium text-red-600 border border-red-200">
              {onlineError}
            </div>
          )}

          <div className="space-y-3">
            <button
              type="button"
              disabled={isJoining}
              onClick={handleCreateRoom}
              className="w-full rounded-[10px] bg-brand-400 py-2.5 text-xs font-semibold text-zinc-950 shadow-xs transition-all hover:-translate-y-0.5 hover:bg-brand-500 disabled:opacity-50"
            >
              {isJoining ? "Đang tạo phòng..." : "⚡ Tạo phòng cờ mới"}
            </button>

            <div className="relative flex items-center justify-center py-1">
              <span className="w-full border-t border-zinc-200" />
              <span className="absolute bg-white px-2 text-[11px] font-medium text-zinc-400">HOẶC</span>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Nhập mã phòng (VD: CR8X9)"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
                className="flex-1 rounded-[10px] border border-zinc-200 px-3 py-2 text-xs uppercase tracking-wider font-semibold text-zinc-900 focus:border-brand-500 focus:outline-none"
              />
              <button
                type="button"
                disabled={isJoining || !roomInput.trim()}
                onClick={() => handleJoinRoom()}
                className="rounded-[10px] bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-zinc-800 disabled:opacity-40"
              >
                Vào chơi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* THÔNG TIN PHÒNG ONLINE ĐANG CHƠI */}
      {mode === "online" && onlineRoomCode && (
        <div className="mb-4 mx-auto max-w-md rounded-[14px] border border-brand-200 bg-brand-50/60 p-3 text-xs flex items-center justify-between shadow-xs">
          <div>
            <span className="text-zinc-500">Mã phòng: </span>
            <strong className="font-bold text-zinc-950 text-sm tracking-wide">{onlineRoomCode}</strong>
            <span className="ml-2 text-zinc-500">
              (Bạn là:{" "}
              <strong className={myRole === "X" ? "text-zinc-950 font-bold" : "text-lime-600 font-bold"}>
                Quân {myRole === "X" ? "✕ (Đen)" : "◯ (Xanh)"}
              </strong>
              )
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-xs hover:border-zinc-300"
            >
              {copiedLink ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
              <span>{copiedLink ? "Đã chép link" : "Mời bạn"}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setOnlineRoomCode(null);
                setOnlineGame(null);
                setMyRole(null);
              }}
              className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-800"
            >
              Rời phòng
            </button>
          </div>
        </div>
      )}

      {/* THÔNG BÁO XỬ THUA DO HẾT THỜI GIAN */}
      {timeoutMessage && (
        <div className="mb-3 mx-auto max-w-md flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2 text-xs font-semibold text-amber-900 shadow-xs animate-shake">
          <AlertCircle size={15} className="text-amber-600 shrink-0" />
          <span>{timeoutMessage}</span>
        </div>
      )}

      {/* BẢNG ĐIỀU KHIỂN, TỈ SỐ & BỘ ĐẾM GIỜ */}
      <div className="mb-4 rounded-[16px] border border-zinc-200 bg-white p-3.5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Người chơi X */}
          <div className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-[8px] font-extrabold text-sm border-2 ${
                activeTurn === "X" && !activeWinner
                  ? "border-zinc-950 bg-zinc-900 text-white shadow-xs"
                  : "border-zinc-300 bg-zinc-100 text-zinc-800"
              }`}
            >
              ✕
            </div>
            <div>
              <div className="text-xs font-bold text-zinc-900">
                {mode === "ai"
                  ? "Bạn (X)"
                  : isOnlineActive
                  ? onlineGame.playerXName
                  : "Kỳ thủ X"}
              </div>
              <div className="text-[11px] font-semibold text-zinc-400">
                {isOnlineActive ? `${onlineGame.scoreX} ván thắng` : `${scoreX} ván thắng`}
              </div>
            </div>
          </div>

          {/* Trạng thái lượt đi, bộ đếm giờ và kết quả */}
          <div className="text-center px-2 flex-1 min-w-[160px]">
            {activeWinner === "X" && (
              <div className="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-3 py-1 text-xs font-bold text-white animate-bounce">
                <Trophy size={13} className="text-brand-400" />
                <span>Quân ✕ Chiến thắng!</span>
              </div>
            )}
            {activeWinner === "O" && (
              <div className="inline-flex items-center gap-1 rounded-full bg-lime-600 px-3 py-1 text-xs font-bold text-white animate-bounce">
                <Trophy size={13} className="text-yellow-300" />
                <span>Quân ◯ Chiến thắng!</span>
              </div>
            )}
            {activeWinner === "DRAW" && (
              <span className="rounded-full bg-zinc-200 px-3 py-1 text-xs font-bold text-zinc-700">
                Hòa cờ!
              </span>
            )}
            {!activeWinner && (
              <div>
                <div className="text-xs font-semibold text-zinc-700">
                  {isOnlineActive ? (
                    onlineGame.status === "WAITING" ? (
                      <span className="text-amber-600 italic">Đang chờ đối thủ vào phòng...</span>
                    ) : activeTurn === myRole ? (
                      <span className="text-brand-800 font-bold">Lượt của bạn! Hãy đặt cờ</span>
                    ) : (
                      <span className="text-zinc-500">Đang chờ đối thủ đi...</span>
                    )
                  ) : isAiThinking ? (
                    <span className="text-brand-700 italic">Máy đang tính nước...</span>
                  ) : (
                    <span>
                      Lượt đi:{" "}
                      <strong className={activeTurn === "X" ? "text-zinc-950 font-bold" : "text-lime-600 font-bold"}>
                        {activeTurn === "X" ? "✕ Quân Đen" : "◯ Quân Xanh"}
                      </strong>
                    </span>
                  )}
                </div>

                {/* Đồng hồ đếm ngược 15s */}
                {timerEnabled && (!isOnlineActive || onlineGame.status === "PLAYING") && (
                  <div className="mt-1.5 flex items-center justify-center gap-2">
                    <span
                      className={`font-mono text-xs font-extrabold transition-colors ${
                        timeLeft <= 5 ? "text-red-600 animate-pulse text-sm" : "text-zinc-700"
                      }`}
                    >
                      ⏱️ {timeLeft}s
                    </span>
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100 border border-zinc-200">
                      <div
                        className={`h-full transition-all duration-1000 ease-linear ${
                          timeLeft <= 5 ? "bg-red-500" : "bg-brand-500"
                        }`}
                        style={{ width: `${(timeLeft / 15) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Người chơi O */}
          <div className="flex items-center gap-2 text-right">
            <div>
              <div className="text-xs font-bold text-zinc-900">
                {mode === "ai"
                  ? `Máy AI (${difficulty === "hard" ? "Cao thủ" : "Dễ"})`
                  : isOnlineActive
                  ? onlineGame.playerOName || "Chờ đối thủ..."
                  : "Kỳ thủ O"}
              </div>
              <div className="text-[11px] font-semibold text-zinc-400">
                {isOnlineActive ? `${onlineGame.scoreO} ván thắng` : `${scoreO} ván thắng`}
              </div>
            </div>
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-[8px] font-extrabold text-sm border-2 ${
                activeTurn === "O" && !activeWinner
                  ? "border-lime-600 bg-lime-500 text-white shadow-xs"
                  : "border-lime-200 bg-lime-50 text-lime-700"
              }`}
            >
              ◯
            </div>
          </div>
        </div>

        {/* Ghi chú quy tắc lượt đi đầu / người thua đi trước */}
        {mode === "ai" && turnReason && (
          <div className="mt-2.5 pt-2 border-t border-zinc-100 text-center text-[11px] text-zinc-500 font-medium">
            {turnReason}
          </div>
        )}
      </div>

      {/* CÁC NÚT THAO TÁC (ĐỘ KHÓ, ĐI LẠI, VÁN MỚI) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          {mode === "ai" && (
            <>
              {/* Chọn độ khó AI */}
              <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 text-xs shadow-xs">
                <button
                  type="button"
                  onClick={() => setDifficulty("easy")}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    difficulty === "easy" ? "bg-zinc-100 font-bold text-zinc-900" : "text-zinc-500 hover:text-zinc-800"
                  }`}
                >
                  Dễ
                </button>
                <button
                  type="button"
                  onClick={() => setDifficulty("hard")}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    difficulty === "hard" ? "bg-zinc-900 font-bold text-white shadow-xs" : "text-zinc-500 hover:text-zinc-800"
                  }`}
                >
                  Cao thủ
                </button>
              </div>

              {/* Nút Đi lại (Undo) */}
              <button
                type="button"
                disabled={moveHistory.length < 2 || isAiThinking || !!winner}
                onClick={handleUndo}
                className="inline-flex items-center gap-1 rounded-[8px] border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 shadow-xs hover:border-zinc-300 hover:text-zinc-900 disabled:opacity-40"
              >
                <RotateCcw size={13} />
                <span>Đi lại</span>
              </button>
            </>
          )}
        </div>

        {/* Nút Chơi ván mới (người thua ván trước được quyền đi trước) */}
        <button
          type="button"
          onClick={isOnlineActive ? handleOnlineReset : handleResetAi}
          className="inline-flex items-center gap-1.5 rounded-[10px] bg-brand-400 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 shadow-xs transition-all hover:-translate-y-0.5 hover:bg-brand-500"
        >
          <RotateCcw size={14} />
          <span>Ván mới</span>
        </button>
      </div>

      {/* BÀN CỜ CARO */}
      <CaroBoard
        board={currentBoard}
        lastMove={currentLastMove}
        winningLine={currentWinningLine}
        currentTurn={activeTurn}
        hoverSymbol={effectiveHoverSymbol}
        disabled={
          Boolean(activeWinner) ||
          isAiThinking ||
          Boolean(isOnlineActive && (onlineGame?.status !== "PLAYING" || activeTurn !== myRole))
        }
        onCellClick={isOnlineActive ? handleOnlineCellClick : handleLocalCellClick}
      />

      {/* Tóm tắt luật chơi chân trang */}
      <div className="mt-8 text-center text-xs text-zinc-400 space-y-1">
        <p>Luật chơi: 5 quân liên tiếp (ngang, dọc, chéo) để chiến thắng.</p>
        <p className="text-[11px] text-zinc-400">
          ⏱️ Mỗi lượt có 15s để suy nghĩ · 🎲 Ván đầu bốc thăm ngẫu nhiên, ván sau người thua được quyền đi trước.
        </p>
      </div>
    </div>
  );
}
