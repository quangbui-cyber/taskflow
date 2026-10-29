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
import CaroBoard, { CaroPiece } from "./CaroBoard";
import {
  createOnlineGame,
  joinOnlineGame,
  getOnlineGame,
  makeOnlineMove,
  startOnlineGame,
  resetOnlineGame,
  handleOnlineTimeout,
  type OnlineGameState,
} from "@/app/actions/caroOnline";
import {
  Bot,
  Copy,
  Check,
  RotateCcw,
  Play,
  Volume2,
  VolumeX,
  Globe,
  Plus,
  Trophy,
  Timer as TimerIcon,
  AlertCircle,
} from "lucide-react";

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

  // Trạng thái đã bấm Bắt đầu hay chưa
  const [isAiStarted, setIsAiStarted] = useState(false);

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

  // Hàm Bắt đầu / Ván mới với AI
  const handleStartAi = useCallback(() => {
    const empty = createEmptyBoard();
    setBoard(empty);
    setLastMove(null);
    setWinner(null);
    setWinningLine([]);
    setMoveHistory([]);
    setIsAiThinking(false);
    setTimeLeft(15);
    setTimeoutMessage(null);
    setIsAiStarted(true);

    // Quy tắc: Nếu ván trước có người thua -> Người thua được đi trước.
    // Nếu ván đầu hoặc hòa: Bốc thăm ngẫu nhiên 50/50.
    let aiGoesFirst: boolean;
    if (lastWinner === "X") {
      aiGoesFirst = true;
    } else if (lastWinner === "O") {
      aiGoesFirst = false;
    } else {
      aiGoesFirst = Math.random() < 0.5;
    }

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
      if (!isAiStarted || winner || board[r][c] !== null || isAiThinking || currentTurn !== "X") return;

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
    [board, currentTurn, difficulty, isAiStarted, isAiThinking, winner]
  );

  // Đi lại (Undo) khi đấu với AI
  const handleUndo = () => {
    if (!isAiStarted || moveHistory.length < 2 || isAiThinking || winner) return;

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

  const handleOnlineStart = async () => {
    if (!onlineRoomCode) return;
    const res = await startOnlineGame(onlineRoomCode);
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
    if (mode === "ai" && (!isAiStarted || isAiThinking)) return;

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
  }, [timerEnabled, activeWinner, mode, onlineGame?.status, activeTurn, isAiThinking, isAiStarted]);

  // Xử lý khi hết 15 giây (xử thua do hết giờ)
  useEffect(() => {
    if (!timerEnabled || timeLeft !== 0 || activeWinner) return;
    if (mode === "ai" && !isAiStarted) return;
    if (mode === "online" && (!onlineGame || onlineGame.status !== "PLAYING")) return;

    caroSound.playTimeout();

    if (mode === "ai") {
      if (currentTurn === "X") {
        setWinner("O");
        setLastWinner("O");
        setScoreO((s) => s + 1);
        setTimeoutMessage("Hết 15 giây! Bạn bị xử thua vì quá thời gian.");
      } else {
        setWinner("X");
        setLastWinner("X");
        setScoreX((s) => s + 1);
        setTimeoutMessage("Máy hết thời gian suy nghĩ, bạn thắng!");
      }
    } else if (mode === "online" && onlineRoomCode && onlineGame?.status === "PLAYING") {
      const timedOutPlayer = onlineGame.turn;
      handleOnlineTimeout(onlineRoomCode, timedOutPlayer).then((res) => {
        if (res.success && res.game) {
          setOnlineGame(res.game);
          const loser = timedOutPlayer === "X" ? res.game.playerXName : res.game.playerOName;
          setTimeoutMessage(`Hết 15 giây! ${loser} bị xử thua vì quá thời gian.`);
        }
      });
    }
  }, [timeLeft, timerEnabled, activeWinner, mode, currentTurn, onlineGame, onlineRoomCode, isAiStarted]);


  // --- Dữ liệu hiển thị ---
  const isPlaying = mode === "ai" ? isAiStarted : onlineGame?.status === "PLAYING";
  const xActive = activeTurn === "X" && !activeWinner && isPlaying;
  const oActive = activeTurn === "O" && !activeWinner && isPlaying;
  const showTimer =
    timerEnabled &&
    !activeWinner &&
    ((mode === "ai" && isAiStarted) || (isOnlineActive && onlineGame.status === "PLAYING"));
  const timeLow = timeLeft <= 5;

  const xName = mode === "ai" ? "Bạn" : isOnlineActive ? onlineGame.playerXName : "Kỳ thủ X";
  const oName =
    mode === "ai"
      ? "Máy"
      : isOnlineActive
      ? onlineGame.playerOName || "Chờ đối thủ…"
      : "Kỳ thủ O";
  const xSub = isOnlineActive && myRole === "X" ? "Bạn · Quân X" : "Quân X";
  const oSub =
    mode === "ai"
      ? difficulty === "hard"
        ? "Cao thủ"
        : "Dễ"
      : isOnlineActive && myRole === "O"
      ? "Bạn · Quân O"
      : "Quân O";
  const shownScoreX = isOnlineActive ? onlineGame.scoreX : scoreX;
  const shownScoreO = isOnlineActive ? onlineGame.scoreO : scoreO;

  let statusText = "";
  let statusMuted = false;
  if (activeWinner === "DRAW") {
    statusText = "Hòa cờ!";
  } else if (activeWinner) {
    if (mode === "ai") {
      statusText = activeWinner === "X" ? "Bạn thắng ván này!" : "Máy thắng ván này";
    } else if (isOnlineActive) {
      statusText =
        activeWinner === myRole
          ? "Bạn thắng ván này!"
          : `${activeWinner === "X" ? onlineGame.playerXName : onlineGame.playerOName} thắng ván này`;
    }
  } else if (mode === "ai") {
    if (!isAiStarted) {
      statusText = "Chưa bắt đầu";
      statusMuted = true;
    } else if (isAiThinking) {
      statusText = "Máy đang tính nước…";
      statusMuted = true;
    } else {
      statusText = "Lượt của bạn";
    }
  } else if (!isOnlineActive) {
    statusText = "Chưa vào phòng";
    statusMuted = true;
  } else if (onlineGame.status === "WAITING") {
    statusText = "Đang chờ đối thủ vào phòng…";
    statusMuted = true;
  } else if (onlineGame.status === "READY") {
    statusText = "Đã đủ 2 người, sẵn sàng!";
  } else if (activeTurn === myRole) {
    statusText = "Lượt của bạn";
  } else {
    statusText = "Đối thủ đang suy nghĩ…";
    statusMuted = true;
  }
  const iWon =
    (mode === "ai" && activeWinner === "X") || (isOnlineActive && !!myRole && activeWinner === myRole);

  const resetLocalBoard = () => {
    setIsAiStarted(false);
    setBoard(createEmptyBoard());
    setLastMove(null);
    setWinner(null);
    setWinningLine([]);
    setTimeLeft(15);
    setTimeoutMessage(null);
  };

  // --- Lớp phủ trên bàn cờ ---
  let boardOverlay: React.ReactNode = null;
  if (mode === "ai" && !isAiStarted) {
    boardOverlay = (
      <OverlayCard titleId="caro-start-title">
        <div className="flex items-center justify-center gap-2.5">
          <PieceTile symbol="X" />
          <span className="text-xs font-semibold text-zinc-500">vs</span>
          <PieceTile symbol="O" />
        </div>
        <h2 id="caro-start-title" className="mt-4 text-lg font-semibold text-zinc-950">
          Sẵn sàng chưa?
        </h2>
        <button type="button" onClick={handleStartAi} className={`mt-5 w-full ${primaryBtn}`}>
          <Play size={14} className="fill-zinc-950" />
          Bắt đầu ván đấu
        </button>
      </OverlayCard>
    );
  } else if (mode === "online" && !onlineRoomCode) {
    boardOverlay = (
      <OverlayCard titleId="caro-online-title">
        <h2 id="caro-online-title" className="text-lg font-semibold text-zinc-950">
          Thách đấu đồng nghiệp
        </h2>

        {onlineError && (
          <p role="alert" className="mt-4 rounded-[10px] bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            {onlineError}
          </p>
        )}

        <button type="button" disabled={isJoining} onClick={handleCreateRoom} className={`mt-5 w-full ${primaryBtn}`}>
          <Plus size={16} />
          {isJoining ? "Đang tạo phòng…" : "Tạo phòng mới"}
        </button>

        <div className="my-4 flex items-center gap-3 text-[11px] font-medium text-zinc-500">
          <span className="h-px flex-1 bg-zinc-200" />
          hoặc
          <span className="h-px flex-1 bg-zinc-200" />
        </div>

        <div className="flex gap-2">
          <label htmlFor="caro-room-code" className="sr-only">
            Mã phòng
          </label>
          <input
            id="caro-room-code"
            type="text"
            placeholder="Nhập mã phòng"
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
            className="h-11 min-w-0 flex-1 rounded-[10px] border border-zinc-200 bg-white px-3 text-[13px] font-semibold uppercase tracking-wider text-zinc-900 placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-zinc-400 focus:border-brand-500 focus:outline-none"
          />
          <button
            type="button"
            disabled={isJoining || !roomInput.trim()}
            onClick={() => handleJoinRoom()}
            className={`h-11 rounded-[10px] bg-zinc-900 px-4 text-[13px] font-semibold text-white hover:bg-zinc-800 ${liftBtn}`}
          >
            Vào chơi
          </button>
        </div>
      </OverlayCard>
    );
  } else if (isOnlineActive && onlineGame.status === "READY") {
    boardOverlay = (
      <OverlayCard titleId="caro-ready-title">
        <div className="flex items-center justify-center gap-2.5">
          <PieceTile symbol="X" />
          <span className="text-xs font-semibold text-zinc-500">vs</span>
          <PieceTile symbol="O" />
        </div>
        <h2 id="caro-ready-title" className="mt-4 text-lg font-semibold text-zinc-950">
          Đã đủ 2 kỳ thủ!
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500">
          {onlineGame.playerXName} (X) vs {onlineGame.playerOName} (O)
        </p>
        <button type="button" onClick={handleOnlineStart} className={`mt-5 w-full ${primaryBtn}`}>
          <Play size={14} className="fill-zinc-950" />
          Bắt đầu ván đấu
        </button>
      </OverlayCard>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-7">
      {/* Tiêu đề & chọn chế độ chơi */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold tracking-wide text-brand-700">Góc giải trí</p>
          <h1 className="text-[28px] font-semibold leading-tight text-zinc-950 sm:text-[30px]">Cờ Caro</h1>
        </div>

        <div role="tablist" aria-label="Chế độ chơi" className="inline-flex gap-0.5 rounded-[12px] bg-zinc-200/60 p-1">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "ai"}
            onClick={() => {
              setMode("ai");
              resetLocalBoard();
            }}
            className={`${segBase} ${mode === "ai" ? segOn : segOff}`}
          >
            <Bot size={16} className={mode === "ai" ? "text-brand-600" : ""} />
            Chơi với máy
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "online"}
            onClick={() => setMode("online")}
            className={`${segBase} ${mode === "online" ? segOn : segOff}`}
          >
            <Globe size={16} className={mode === "online" ? "text-brand-600" : ""} />
            Chơi online
          </button>
        </div>
      </header>

      {/* Điện thoại: tỉ số → bàn cờ → điều khiển. Desktop: bàn cờ bên trái, cột thông tin bên phải. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr] lg:gap-x-8">
        {/* Phòng online + tỉ số */}
        <div className="space-y-4 lg:col-start-2 lg:row-start-1">
          {mode === "online" && onlineRoomCode && (
            <section
              aria-label="Phòng online"
              className="flex items-center justify-between gap-3 rounded-[14px] border border-brand-200 bg-brand-50 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-xs text-zinc-500">Mã phòng</p>
                <p className="truncate text-base font-semibold tracking-wide text-zinc-950">{onlineRoomCode}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className={`h-10 rounded-[10px] border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-800 hover:border-zinc-300 ${liftBtn}`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {copiedLink ? <Check size={14} className="text-brand-700" /> : <Copy size={14} />}
                    {copiedLink ? "Đã chép link" : "Mời bạn"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOnlineRoomCode(null);
                    setOnlineGame(null);
                    setMyRole(null);
                  }}
                  className={`h-10 rounded-[10px] px-3 text-xs font-medium text-zinc-600 hover:bg-white hover:text-zinc-900 ${liftBtn}`}
                >
                  Rời phòng
                </button>
              </div>
            </section>
          )}

          <section
            aria-label="Tỉ số"
            className="space-y-4 rounded-[18px] border border-zinc-200 bg-white p-4 shadow-sm sm:p-5"
          >
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <PlayerBlock symbol="X" name={xName} sub={xSub} active={xActive} />
              <div
                aria-label={`Tỉ số ${shownScoreX} - ${shownScoreO}`}
                className="flex items-center gap-2.5 text-[28px] font-semibold tabular-nums text-zinc-950 sm:text-[32px]"
              >
                <span>{shownScoreX}</span>
                <span className="text-lg text-zinc-400">–</span>
                <span>{shownScoreO}</span>
              </div>
              <PlayerBlock symbol="O" name={oName} sub={oSub} active={oActive} />
            </div>

            <div className="space-y-2.5 border-t border-zinc-100 pt-4" aria-live="polite">
              {activeWinner && activeWinner !== "DRAW" ? (
                <div
                  className={`flex items-center gap-2 rounded-[12px] px-3 py-2.5 text-sm font-semibold ${
                    iWon ? "bg-brand-50 text-brand-900" : "bg-zinc-100 text-zinc-800"
                  }`}
                >
                  <Trophy size={16} className={iWon ? "text-brand-700" : "text-zinc-500"} />
                  {statusText}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className={`text-[15px] font-semibold ${statusMuted ? "text-zinc-500" : "text-zinc-950"}`}>
                    {statusText}
                  </span>
                  {showTimer && (
                    <span
                      aria-hidden="true"
                      className={`font-mono text-[13px] font-semibold tabular-nums ${
                        timeLow ? "text-amber-700" : "text-zinc-600"
                      }`}
                    >
                      {timeLeft}s
                    </span>
                  )}
                </div>
              )}

              {showTimer && (
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
                  <div
                    className={`h-full w-full origin-left rounded-full transition-transform duration-1000 ease-linear motion-reduce:transition-none ${
                      timeLow ? "bg-amber-500" : "bg-brand-500"
                    }`}
                    style={{ transform: `scaleX(${timeLeft / 15})` }}
                  />
                </div>
              )}

              {timeoutMessage && (
                <p className="flex items-start gap-1.5 text-xs font-medium text-amber-800">
                  <AlertCircle size={14} className="mt-px shrink-0 text-amber-600" />
                  {timeoutMessage}
                </p>
              )}
            </div>
          </section>
        </div>

        {/* Bàn cờ */}
        <section aria-label="Bàn cờ" className="lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <div className="mx-auto w-full max-w-[640px] lg:mx-0 lg:max-w-[clamp(440px,calc(100dvh_-_220px),640px)]">
            <CaroBoard
              board={currentBoard}
              lastMove={currentLastMove}
              winningLine={currentWinningLine}
              currentTurn={activeTurn}
              hoverSymbol={effectiveHoverSymbol}
              disabled={
                (mode === "ai" && (!isAiStarted || Boolean(winner) || isAiThinking)) ||
                (mode === "online" && !isOnlineActive) ||
                (isOnlineActive &&
                  (onlineGame?.status !== "PLAYING" || activeTurn !== myRole || Boolean(activeWinner)))
              }
              onCellClick={isOnlineActive ? handleOnlineCellClick : handleLocalCellClick}
              overlay={boardOverlay}
            />
          </div>
        </section>

        {/* Điều khiển */}
        <section aria-label="Điều khiển" className="space-y-4 lg:col-start-2 lg:row-start-2">
          {mode === "ai" && (
            <div className="space-y-2">
              <p id="caro-difficulty" className="text-xs font-semibold text-zinc-600">
                Độ khó
              </p>
              <div
                role="radiogroup"
                aria-labelledby="caro-difficulty"
                className="grid grid-cols-2 gap-0.5 rounded-[12px] bg-zinc-200/60 p-1"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={difficulty === "easy"}
                  onClick={() => setDifficulty("easy")}
                  className={`${segBase} ${difficulty === "easy" ? segOn : segOff}`}
                >
                  Dễ
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={difficulty === "hard"}
                  onClick={() => setDifficulty("hard")}
                  className={`${segBase} ${difficulty === "hard" ? segOn : segOff}`}
                >
                  Cao thủ
                </button>
              </div>
            </div>
          )}

          {mode === "ai" && isAiStarted && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={moveHistory.length < 2 || isAiThinking || !!winner}
                onClick={handleUndo}
                className={`w-full ${secondaryBtn}`}
              >
                <RotateCcw size={16} />
                Đi lại
              </button>
              <button type="button" onClick={handleStartAi} className={`w-full ${primaryBtn}`}>
                <Plus size={16} />
                Ván mới
              </button>
            </div>
          )}

          {isOnlineActive && onlineGame.status !== "WAITING" && onlineGame.status !== "READY" && (
            <button type="button" onClick={handleOnlineStart} className={`w-full ${primaryBtn}`}>
              <Plus size={16} />
              Ván mới
            </button>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={timerEnabled}
              onClick={() => {
                setTimerEnabled((t) => !t);
                setTimeLeft(15);
                setTimeoutMessage(null);
              }}
              className={`w-full ${toggleBtn} ${timerEnabled ? toggleOn : toggleOff}`}
            >
              <TimerIcon size={16} />
              {timerEnabled ? "Đếm giờ 15s" : "Đếm giờ tắt"}
            </button>
            <button
              type="button"
              aria-pressed={soundOn}
              onClick={handleToggleSound}
              className={`w-full ${toggleBtn} ${soundOn ? toggleOn : toggleOff}`}
            >
              {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
              {soundOn ? "Âm thanh bật" : "Âm thanh tắt"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

// --- Kiểu nút dùng chung ---
const liftBtn =
  "transition-[transform,background-color,border-color] duration-150 ease-out hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 disabled:pointer-events-none disabled:opacity-45";
const primaryBtn = `inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-brand-400 px-4 text-[13px] font-semibold text-zinc-950 shadow-sm hover:bg-brand-500 ${liftBtn}`;
const secondaryBtn = `inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-zinc-200 bg-white px-4 text-[13px] font-semibold text-zinc-800 hover:border-zinc-300 ${liftBtn}`;
const toggleBtn = `inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border px-3 text-[13px] ${liftBtn}`;
const toggleOn = "border-brand-200 bg-brand-50 font-semibold text-brand-900";
const toggleOff = "border-zinc-200 bg-white font-medium text-zinc-600 hover:border-zinc-300";
const segBase =
  "inline-flex h-10 items-center justify-center gap-2 rounded-[10px] px-4 text-[13px] transition-colors duration-150 ease-out motion-reduce:transition-none";
const segOn = "bg-white font-semibold text-zinc-950 shadow-sm";
const segOff = "font-medium text-zinc-600 hover:text-zinc-950";

function PieceTile({ symbol, active = false }: { symbol: Player; active?: boolean }) {
  const ring = active
    ? symbol === "X"
      ? "shadow-[inset_0_0_0_2px_#18181b]"
      : "shadow-[inset_0_0_0_2px_#93bb24]"
    : "";
  return (
    <span
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] ${
        symbol === "X" ? "bg-zinc-100" : "bg-brand-50"
      } ${ring}`}
    >
      <CaroPiece symbol={symbol} className="h-[22px] w-[22px]" />
    </span>
  );
}

function PlayerBlock({
  symbol,
  name,
  sub,
  active,
}: {
  symbol: Player;
  name: string;
  sub: string;
  active: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      <PieceTile symbol={symbol} active={active} />
      <div className="min-w-0 max-w-full">
        <p className="truncate text-sm font-semibold text-zinc-950">{name}</p>
        <p className="truncate text-xs text-zinc-500">{active ? "Đang đi" : sub}</p>
      </div>
    </div>
  );
}

function OverlayCard({ titleId, children }: { titleId: string; children: React.ReactNode }) {
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="w-full max-w-[320px] rounded-[18px] border border-zinc-200 bg-white px-6 pb-6 pt-7 text-center shadow-md"
    >
      {children}
    </div>
  );
}
