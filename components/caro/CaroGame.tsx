"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  createEmptyBoard,
  checkWin,
  isBoardFull,
  getAiMove,
  type Board,
  type Cell,
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
  type OnlineGameState,
} from "@/app/actions/caroOnline";
import {
  Bot,
  Copy,
  Check,
  RotateCcw,
  Volume2,
  VolumeX,
  Users,
  Globe,
  Sparkles,
  Trophy,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

type GameMode = "ai" | "pass" | "online";
type AiDifficulty = "easy" | "hard";

interface CaroGameProps {
  initialRoomCode?: string | null;
  currentUserName?: string;
}

export default function CaroGame({ initialRoomCode = null, currentUserName = "Tôi" }: CaroGameProps) {
  const [mode, setMode] = useState<GameMode>(initialRoomCode ? "online" : "ai");
  const [difficulty, setDifficulty] = useState<AiDifficulty>("hard");
  const [soundOn, setSoundOn] = useState(true);

  // Local state (cho chế độ AI và Pass & Play)
  const [board, setBoard] = useState<Board>(createEmptyBoard);
  const [currentTurn, setCurrentTurn] = useState<Player>("X");
  const [lastMove, setLastMove] = useState<Point | null>(null);
  const [winner, setWinner] = useState<Player | "DRAW" | null>(null);
  const [winningLine, setWinningLine] = useState<Point[]>([]);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [moveHistory, setMoveHistory] = useState<{ r: number; c: number; player: Player }[]>([]);

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

  useEffect(() => {
    setSoundOn(caroSound.isEnabled());
  }, []);

  const handleToggleSound = () => {
    const next = caroSound.toggle();
    setSoundOn(next);
  };

  // Reset ván đấu Local (AI hoặc Pass & Play)
  const handleResetLocal = useCallback(() => {
    setBoard(createEmptyBoard());
    setCurrentTurn("X");
    setLastMove(null);
    setWinner(null);
    setWinningLine([]);
    setMoveHistory([]);
    setIsAiThinking(false);
  }, []);

  // Xử lý nước đi người chơi ở chế độ Local
  const handleLocalCellClick = useCallback(
    (r: number, c: number) => {
      if (winner || board[r][c] !== null || isAiThinking) return;

      caroSound.playStone();

      const newBoard = board.map((row) => [...row]);
      newBoard[r][c] = currentTurn;
      const move = { r, c };
      setBoard(newBoard);
      setLastMove(move);
      setMoveHistory((prev) => [...prev, { r, c, player: currentTurn }]);

      const winResult = checkWin(newBoard, r, c, currentTurn);
      if (winResult.won) {
        setWinner(currentTurn);
        setWinningLine(winResult.line);
        caroSound.playWin();
        if (currentTurn === "X") setScoreX((s) => s + 1);
        else setScoreO((s) => s + 1);
        return;
      }

      if (isBoardFull(newBoard)) {
        setWinner("DRAW");
        return;
      }

      const nextTurn: Player = currentTurn === "X" ? "O" : "X";
      setCurrentTurn(nextTurn);

      // Nếu là chế độ AI và tới lượt AI (O)
      if (mode === "ai" && nextTurn === "O") {
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
              setWinningLine(aiWin.line);
              caroSound.playWin();
              setScoreO((s) => s + 1);
            } else if (isBoardFull(aiBoard)) {
              setWinner("DRAW");
            } else {
              setCurrentTurn("X");
            }
          }
          setIsAiThinking(false);
        }, 320);
      }
    },
    [board, currentTurn, difficulty, isAiThinking, mode, winner]
  );

  // Đi lại (Undo) khi đấu với AI
  const handleUndo = () => {
    if (mode !== "ai" || moveHistory.length < 2 || isAiThinking || winner) return;
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
  };

  // --- ONLINE MULTIPLAYER LOGIC ---
  const handleCreateRoom = async () => {
    setIsJoining(true);
    setOnlineError(null);
    const res = await createOnlineGame(currentUserName);
    setIsJoining(false);
    if (res.success && res.game) {
      setOnlineRoomCode(res.game.code);
      setOnlineGame(res.game);
      setMyRole("X");
    } else {
      setOnlineError(res.error || "Không thể tạo phòng.");
    }
  };

  const handleJoinRoom = async (codeToJoin?: string) => {
    const code = (codeToJoin || roomInput).trim().toUpperCase();
    if (!code) return;
    setIsJoining(true);
    setOnlineError(null);
    const res = await joinOnlineGame(code, currentUserName);
    setIsJoining(false);
    if (res.success && res.game) {
      setOnlineRoomCode(res.game.code);
      setOnlineGame(res.game);
      setMyRole(res.role || "O");
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
        // Kiểm tra xem có nước đi mới không để phát âm thanh
        if (
          onlineGame &&
          res.game.lastMove &&
          (!onlineGame.lastMove ||
            onlineGame.lastMove.r !== res.game.lastMove.r ||
            onlineGame.lastMove.c !== res.game.lastMove.c)
        ) {
          caroSound.playStone();
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
  const isOnlineActive = mode === "online" && onlineGame;
  const currentBoard = isOnlineActive ? onlineGame.board : board;
  const currentLastMove = isOnlineActive ? onlineGame.lastMove : lastMove;
  const currentWinningLine = isOnlineActive ? onlineGame.winningLine : winningLine;
  const activeWinner = isOnlineActive ? onlineGame.winner : winner;
  const activeTurn = isOnlineActive ? onlineGame.turn : currentTurn;

  return (
    <div className="mx-auto max-w-4xl px-3 sm:px-6 py-6 sm:py-8 font-sans">
      {/* Thanh Header điều hướng */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="group inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 transition-colors hover:text-zinc-950"
        >
          <ArrowLeft size={16} className="transition-transform duration-150 group-hover:-translate-x-0.5" />
          <span>Trang chủ myCreative</span>
        </Link>

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

      {/* Tiêu đề & Chọn chế độ chơi */}
      <div className="mb-6 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-100/70 px-3 py-0.5 text-xs font-semibold text-brand-900 mb-2">
          <Sparkles size={13} className="text-brand-700" />
          <span>Góc Giải Trí Creative</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-950">
          Cờ Caro 15x15
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-zinc-500">
          5 quân liên tiếp để chiến thắng · Thư giãn & đấu trí cùng đồng nghiệp
        </p>

        {/* Thanh chọn 3 chế độ chơi */}
        <div className="mt-4 inline-flex rounded-full border border-zinc-200 bg-zinc-100/80 p-1 shadow-xs">
          <button
            type="button"
            onClick={() => {
              setMode("ai");
              handleResetLocal();
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 ${
              mode === "ai" ? "bg-white text-zinc-950 shadow-xs" : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            <Bot size={14} className={mode === "ai" ? "text-brand-600" : ""} />
            <span>Đấu với Máy</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("pass");
              handleResetLocal();
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 ${
              mode === "pass" ? "bg-white text-zinc-950 shadow-xs" : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            <Users size={14} className={mode === "pass" ? "text-brand-600" : ""} />
            <span>Chung máy (1vs1)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("online");
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 ${
              mode === "online" ? "bg-white text-zinc-950 shadow-xs" : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            <Globe size={14} className={mode === "online" ? "text-brand-600" : ""} />
            <span>Đấu Online</span>
          </button>
        </div>
      </div>

      {/* KHU VỰC ĐIỀU KHIỂN CHẾ ĐỘ ONLINE (TẠO PHÒNG / THAM GIA) */}
      {mode === "online" && !onlineRoomCode && (
        <div className="mb-6 mx-auto max-w-md rounded-[16px] border border-zinc-200 bg-white p-5 shadow-xs text-center">
          <h2 className="text-sm font-bold text-zinc-900 mb-1">Thách đấu đồng nghiệp qua mạng</h2>
          <p className="text-xs text-zinc-500 mb-4">
            Tạo một phòng mới và gửi link cho bạn bè, hoặc nhập mã phòng để vào chơi.
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
              (Bạn là quân:{" "}
              <strong className={myRole === "X" ? "text-zinc-950 font-bold" : "text-lime-600 font-bold"}>
                {myRole}
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

      {/* BẢNG ĐIỀU KHIỂN & BẢNG ĐIỂM */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-zinc-200 bg-white p-3.5 shadow-xs">
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
                : "Kỳ thủ 1 (X)"}
            </div>
            <div className="text-[11px] font-semibold text-zinc-400">
              {isOnlineActive ? `${onlineGame.scoreX} ván thắng` : `${scoreX} ván thắng`}
            </div>
          </div>
        </div>

        {/* Trạng thái lượt đi hoặc kết quả */}
        <div className="text-center px-2">
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
            <div className="text-xs font-semibold text-zinc-600">
              {isOnlineActive ? (
                onlineGame.status === "WAITING" ? (
                  <span className="text-amber-600 italic">Đang chờ đối thủ vào phòng...</span>
                ) : activeTurn === myRole ? (
                  <span className="text-brand-800 font-bold">Lượt của bạn! Hãy đặt cờ</span>
                ) : (
                  <span className="text-zinc-400">Đang chờ đối phương đi...</span>
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
                : "Kỳ thủ 2 (O)"}
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

      {/* CÁC NÚT THAO TÁC (ĐI LẠI, VÁN MỚI, CHỌN ĐỘ KHÓ) */}
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

        {/* Nút Chơi ván mới */}
        <button
          type="button"
          onClick={isOnlineActive ? handleOnlineReset : handleResetLocal}
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
        disabled={
          Boolean(activeWinner) ||
          isAiThinking ||
          Boolean(isOnlineActive && (onlineGame?.status !== "PLAYING" || activeTurn !== myRole))
        }
        onCellClick={isOnlineActive ? handleOnlineCellClick : handleLocalCellClick}
      />

      {/* Luật chơi vắn tắt chân trang */}
      <div className="mt-8 text-center text-xs text-zinc-400">
        Luật chơi: Tạo thành một hàng 5 quân liên tiếp (ngang, dọc hoặc chéo) để giành chiến thắng.
      </div>
    </div>
  );
}
