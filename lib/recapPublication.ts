import { toDateInputVN } from "./dates";
import { isRecapActionDone, recapExportContent, type RecapActionItemRow } from "./meetingRecap";

export type RecapPerson = { id: string; name: string; avatarUrl: string | null };
export type RecapActionItemView = {
  id: string;
  title: string;
  owner: RecapPerson | null;
  ownerName: string | null;
  dueDate: string | null;
  dueText: string | null;
  done: boolean;
  task: { id: string; status: string; projectId: string; projectName: string } | null;
};
export type RecapSuggestion = {
  id: string;
  title: string;
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  dueText: string | null;
};
export type PublishedRecap = { content: string; actionItems: RecapActionItemView[] };

type ActionRow = {
  id: string; title: string; owner: RecapPerson | null; ownerName: string | null;
  dueDate: Date | null; dueText: string | null; doneAt: Date | null;
  task: { id: string; status: string; projectId: string; project: { name: string } } | null;
};

export function toRecapActionView(item: ActionRow): RecapActionItemView {
  return {
    id: item.id, title: item.title, owner: item.owner, ownerName: item.ownerName,
    dueDate: item.dueDate ? toDateInputVN(item.dueDate) : null, dueText: item.dueText,
    done: isRecapActionDone(item),
    task: item.task ? { id: item.task.id, status: item.task.status, projectId: item.task.projectId, projectName: item.task.project.name } : null,
  };
}

// Snapshot JSON is written only by the server/migration. Fail closed if absent:
// never fall back to the mutable draft for an attendee.
export function readPublishedRecap(value: unknown): PublishedRecap | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<PublishedRecap>;
  if (typeof data.content !== "string" || !Array.isArray(data.actionItems)) return null;
  return data as PublishedRecap;
}

export function readRecapSuggestions(value: unknown): RecapSuggestion[] {
  return Array.isArray(value) ? value as RecapSuggestion[] : [];
}

export function publishedRecapExport(snapshot: PublishedRecap): string {
  return recapExportContent(snapshot.content, snapshot.actionItems.map((item) => ({
    title: item.title, owner: item.owner?.name ?? item.ownerName,
    dueDate: item.dueDate ? new Date(`${item.dueDate}T17:00:00+07:00`) : null,
    dueText: item.dueText, done: item.done,
  })));
}

/** Only progress can change after sharing; draft titles, owners and new tasks stay private. */
export function publishedActionProgress(snapshot: PublishedRecap, live: RecapActionItemView[]): RecapActionItemView[] {
  const byId = new Map(live.map((item) => [item.id, item]));
  return snapshot.actionItems.map((item) => {
    const current = byId.get(item.id);
    if (!current) return item;
    if (item.task) {
      if (current.task?.id !== item.task.id) return item;
      return { ...item, done: current.done, task: { ...item.task, status: current.task.status } };
    }
    return { ...item, done: current.done };
  });
}

const titleKey = (title: string) => title.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");

/** Rewrites only propose additions; existing rows and task links are never replaced. */
export function newRecapSuggestions(rows: RecapActionItemRow[], existing: { title: string }[], makeId: () => string): RecapSuggestion[] {
  const seen = new Set(existing.map((item) => titleKey(item.title)));
  return rows.flatMap((row) => {
    const key = titleKey(row.title);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id: makeId(), title: row.title, ownerId: row.ownerId, ownerName: row.ownerName,
      dueDate: row.dueDate?.toISOString() ?? null, dueText: row.dueText }];
  });
}
