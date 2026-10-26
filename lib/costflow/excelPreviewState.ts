export type ExcelPreviewServerState =
  | "ACTIONABLE"
  | "READ_ONLY_CONSUMED"
  | "NON_ACTIONABLE_EXPIRED"
  | "NON_ACTIONABLE_SUPERSEDED"
  | "NON_ACTIONABLE_CANCELLED";

export type ExcelPreviewPendingSourceChange<S, P> = {
  source: S;
  requiresDiscardWarning: boolean;
  previous: {
    selectedSource: S;
    actionableSessionId: string | null;
    projection: P | null;
    corrections: Record<string, string>;
    decimalResolutions: Record<string, "VISIBLE" | "CANONICAL">;
    selectedDeletionIds: string[];
    aggregateDeletionConfirmed: boolean;
  };
};

export type ExcelPreviewState<S, P> = {
  selectedSource: S;
  sourceRevision: number;
  requestRevision: number | null;
  actionableSessionId: string | null;
  serverState: ExcelPreviewServerState | null;
  currentProjection: P | null;
  staleProjection: P | null;
  corrections: Record<string, string>;
  decimalResolutions: Record<string, "VISIBLE" | "CANONICAL">;
  selectedDeletionIds: string[];
  aggregateDeletionConfirmed: boolean;
  pendingSourceChange: ExcelPreviewPendingSourceChange<S, P> | null;
  pending: boolean;
  notice: string;
  error: string;
};

export type ExcelPreviewAction<S, P> =
  | { type: "SOURCE_CHANGE_INTENT"; source: S }
  | { type: "SOURCE_CANCELLED" }
  | { type: "SOURCE_CANCEL_FAILED"; message: string }
  | { type: "STAY_CONFIRMED"; serverState: ExcelPreviewServerState }
  | { type: "REQUEST_STARTED"; sourceRevision: number }
  | { type: "RESPONSE_SUCCEEDED"; sourceRevision: number; sessionId: string; projection: P }
  | { type: "RESPONSE_FAILED"; sourceRevision: number; message: string }
  | { type: "SESSION_LOADED"; serverState: ExcelPreviewServerState; sessionId: string; projection: P | null }
  | { type: "SERVER_STATUS"; serverState: ExcelPreviewServerState }
  | { type: "SET_CORRECTION"; key: string; value: string }
  | { type: "SET_DECIMAL_RESOLUTION"; key: string; value: "VISIBLE" | "CANONICAL" }
  | { type: "SET_DELETIONS"; ids: string[] }
  | { type: "CONFIRM_DELETIONS"; confirmed: boolean }
  | { type: "CLEAR_NOTICE" };

export function createExcelPreviewState<S, P = unknown>(selectedSource: S): ExcelPreviewState<S, P> {
  return {
    selectedSource,
    sourceRevision: 1,
    requestRevision: null,
    actionableSessionId: null,
    serverState: null,
    currentProjection: null,
    staleProjection: null,
    corrections: {},
    decimalResolutions: {},
    selectedDeletionIds: [],
    aggregateDeletionConfirmed: false,
    pendingSourceChange: null,
    pending: false,
    notice: "",
    error: "",
  };
}

const hasChoices = <S, P>(state: ExcelPreviewState<S, P>) =>
  Object.keys(state.corrections).length > 0
  || Object.keys(state.decimalResolutions).length > 0
  || state.selectedDeletionIds.length > 0;

const staleResponse = <S, P>(state: ExcelPreviewState<S, P>) => ({
  ...state,
  notice: "Đã bỏ kết quả của nguồn cũ",
});

export function reduceExcelPreviewState<S, P>(state: ExcelPreviewState<S, P>, action: ExcelPreviewAction<S, P>): ExcelPreviewState<S, P> {
  if (action.type === "SOURCE_CHANGE_INTENT") {
    if (state.pendingSourceChange) return state;
    return {
      ...state,
      actionableSessionId: null,
      serverState: state.actionableSessionId ? null : state.serverState,
      currentProjection: null,
      staleProjection: state.currentProjection ?? state.staleProjection,
      pendingSourceChange: {
        source: action.source,
        requiresDiscardWarning: hasChoices(state),
        previous: {
          selectedSource: state.selectedSource,
          actionableSessionId: state.actionableSessionId,
          projection: state.currentProjection,
          corrections: state.corrections,
          decimalResolutions: state.decimalResolutions,
          selectedDeletionIds: state.selectedDeletionIds,
          aggregateDeletionConfirmed: state.aggregateDeletionConfirmed,
        },
      },
      notice: "",
      error: "",
    };
  }
  if (action.type === "SOURCE_CANCELLED") {
    if (!state.pendingSourceChange) return state;
    return {
      ...state,
      selectedSource: state.pendingSourceChange.source,
      sourceRevision: state.sourceRevision + 1,
      requestRevision: null,
      serverState: "NON_ACTIONABLE_CANCELLED",
      corrections: {},
      decimalResolutions: {},
      selectedDeletionIds: [],
      aggregateDeletionConfirmed: false,
      pendingSourceChange: null,
      pending: false,
      error: "",
    };
  }
  if (action.type === "SOURCE_CANCEL_FAILED") {
    if (!state.pendingSourceChange) return { ...state, error: action.message };
    const previous = state.pendingSourceChange.previous;
    return {
      ...state,
      selectedSource: previous.selectedSource,
      actionableSessionId: previous.actionableSessionId,
      serverState: previous.actionableSessionId ? "ACTIONABLE" : state.serverState,
      currentProjection: previous.projection,
      staleProjection: null,
      corrections: previous.corrections,
      decimalResolutions: previous.decimalResolutions,
      selectedDeletionIds: previous.selectedDeletionIds,
      aggregateDeletionConfirmed: previous.aggregateDeletionConfirmed,
      pendingSourceChange: null,
      pending: false,
      error: action.message,
    };
  }
  if (action.type === "STAY_CONFIRMED") {
    if (!state.pendingSourceChange) return state;
    const previous = state.pendingSourceChange.previous;
    if (action.serverState !== "ACTIONABLE") {
      return { ...state, pendingSourceChange: null, serverState: action.serverState, error: "Phiên cũ không còn hiệu lực trên máy chủ." };
    }
    return {
      ...state,
      selectedSource: previous.selectedSource,
      actionableSessionId: previous.actionableSessionId,
      serverState: "ACTIONABLE",
      currentProjection: previous.projection,
      staleProjection: null,
      corrections: previous.corrections,
      decimalResolutions: previous.decimalResolutions,
      selectedDeletionIds: previous.selectedDeletionIds,
      aggregateDeletionConfirmed: previous.aggregateDeletionConfirmed,
      pendingSourceChange: null,
      error: "",
    };
  }
  if (action.type === "REQUEST_STARTED") return { ...state, requestRevision: action.sourceRevision, pending: true, error: "" };
  if (action.type === "RESPONSE_SUCCEEDED") {
    if (action.sourceRevision !== state.sourceRevision) return staleResponse(state);
    return {
      ...state,
      requestRevision: null,
      actionableSessionId: action.sessionId,
      serverState: "ACTIONABLE",
      currentProjection: action.projection,
      staleProjection: null,
      corrections: {},
      decimalResolutions: {},
      selectedDeletionIds: [],
      aggregateDeletionConfirmed: false,
      pending: false,
      notice: "",
      error: "",
    };
  }
  if (action.type === "RESPONSE_FAILED") {
    if (action.sourceRevision !== state.sourceRevision) return staleResponse(state);
    return { ...state, requestRevision: null, pending: false, error: `${action.message} Dữ liệu và các ô đã sửa vẫn được giữ.` };
  }
  if (action.type === "SESSION_LOADED") {
    return {
      ...state,
      actionableSessionId: action.serverState === "ACTIONABLE" ? action.sessionId : null,
      serverState: action.serverState,
      currentProjection: action.projection,
      staleProjection: action.serverState === "ACTIONABLE" ? null : action.projection ?? state.staleProjection,
      corrections: {},
      decimalResolutions: {},
      selectedDeletionIds: [],
      aggregateDeletionConfirmed: false,
      pending: false,
      error: "",
    };
  }
  if (action.type === "SERVER_STATUS") {
    if (action.serverState === "ACTIONABLE") return { ...state, serverState: action.serverState };
    return { ...state, actionableSessionId: null, serverState: action.serverState, currentProjection: null, staleProjection: state.currentProjection ?? state.staleProjection };
  }
  if (action.type === "SET_CORRECTION") return { ...state, corrections: { ...state.corrections, [action.key]: action.value } };
  if (action.type === "SET_DECIMAL_RESOLUTION") return { ...state, decimalResolutions: { ...state.decimalResolutions, [action.key]: action.value } };
  if (action.type === "SET_DELETIONS") return { ...state, selectedDeletionIds: [...new Set(action.ids)], aggregateDeletionConfirmed: false };
  if (action.type === "CONFIRM_DELETIONS") return { ...state, aggregateDeletionConfirmed: action.confirmed };
  return { ...state, notice: "" };
}
