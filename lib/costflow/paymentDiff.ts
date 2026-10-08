export type PaymentDocumentSnapshot = {
  id?: string;
  name: string;
  sha256?: string;
};

export type PaymentDossierLineSnapshot = {
  stableKey: string;
  position: number;
  description: string;
  amount: string;
  icRevisionId: string;
  icLineId: string;
  recipientKey: string;
  documents: PaymentDocumentSnapshot[];
};

export type PaymentDossierSnapshot = {
  title: string;
  milestone: string;
  explanation: string;
  lines: PaymentDossierLineSnapshot[];
};

export type PaymentFieldChange = {
  field: string;
  before: string | number;
  after: string | number;
};

export type PaymentLineChange = {
  stableKey: string;
  kind: "ADDED" | "REMOVED" | "CHANGED";
  before?: PaymentDossierLineSnapshot;
  after?: PaymentDossierLineSnapshot;
  changes: PaymentFieldChange[];
};

export type PaymentDossierDiff = {
  changed: boolean;
  headerChanges: PaymentFieldChange[];
  lineChanges: PaymentLineChange[];
  documents: { added: PaymentDocumentSnapshot[]; removed: PaymentDocumentSnapshot[] };
  totals: { before: string; after: string };
  recipientTotals: { before: Record<string, string>; after: Record<string, string> };
};

const exactInteger = (value: string) => {
  if (!/^\d+$/.test(value)) throw new Error("Số tiền snapshot phải là số nguyên VND không âm.");
  return BigInt(value);
};

const sum = (values: string[]) => values.reduce((total, value) => total + exactInteger(value), BigInt(0)).toString();

const recipientTotals = (lines: PaymentDossierLineSnapshot[]) => {
  const totals = new Map<string, bigint>();
  for (const line of lines) totals.set(line.recipientKey, (totals.get(line.recipientKey) ?? BigInt(0)) + exactInteger(line.amount));
  return Object.fromEntries([...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, amount]) => [key, amount.toString()]));
};

const documentKey = (document: PaymentDocumentSnapshot) => document.sha256 ? `sha256:${document.sha256}` : `id:${document.id ?? ""}:${document.name}`;

const dossierDocuments = (snapshot: PaymentDossierSnapshot) => {
  const unique = new Map<string, PaymentDocumentSnapshot>();
  for (const document of snapshot.lines.flatMap(line => line.documents)) unique.set(documentKey(document), document);
  return unique;
};

const changedField = (changes: PaymentFieldChange[], field: string, before: string | number, after: string | number) => {
  if (before !== after) changes.push({ field, before, after });
};

export function diffPaymentDossiers(before: PaymentDossierSnapshot, after: PaymentDossierSnapshot): PaymentDossierDiff {
  const headerChanges: PaymentFieldChange[] = [];
  changedField(headerChanges, "title", before.title, after.title);
  changedField(headerChanges, "milestone", before.milestone, after.milestone);
  changedField(headerChanges, "explanation", before.explanation, after.explanation);

  const beforeLines = new Map(before.lines.map(line => [line.stableKey, line]));
  const afterLines = new Map(after.lines.map(line => [line.stableKey, line]));
  if (beforeLines.size !== before.lines.length || afterLines.size !== after.lines.length) throw new Error("stableKey của khoản đề nghị phải duy nhất trong từng phiên bản.");
  const stableKeys = [...new Set([...beforeLines.keys(), ...afterLines.keys()])].sort();
  const lineChanges: PaymentLineChange[] = [];
  for (const stableKey of stableKeys) {
    const previous = beforeLines.get(stableKey);
    const current = afterLines.get(stableKey);
    if (!previous && current) {
      lineChanges.push({ stableKey, kind: "ADDED", after: current, changes: [] });
      continue;
    }
    if (previous && !current) {
      lineChanges.push({ stableKey, kind: "REMOVED", before: previous, changes: [] });
      continue;
    }
    if (!previous || !current) continue;
    const changes: PaymentFieldChange[] = [];
    changedField(changes, "position", previous.position, current.position);
    changedField(changes, "description", previous.description, current.description);
    changedField(changes, "amount", previous.amount, current.amount);
    changedField(changes, "icRevisionId", previous.icRevisionId, current.icRevisionId);
    changedField(changes, "icLineId", previous.icLineId, current.icLineId);
    changedField(changes, "recipientKey", previous.recipientKey, current.recipientKey);
    const previousDocuments = [...new Set(previous.documents.map(documentKey))].sort().join("|");
    const currentDocuments = [...new Set(current.documents.map(documentKey))].sort().join("|");
    changedField(changes, "documents", previousDocuments, currentDocuments);
    if (changes.length) lineChanges.push({ stableKey, kind: "CHANGED", before: previous, after: current, changes });
  }

  const beforeDocuments = dossierDocuments(before);
  const afterDocuments = dossierDocuments(after);
  const added = [...afterDocuments].filter(([key]) => !beforeDocuments.has(key)).map(([, document]) => document);
  const removed = [...beforeDocuments].filter(([key]) => !afterDocuments.has(key)).map(([, document]) => document);
  const totals = { before: sum(before.lines.map(line => line.amount)), after: sum(after.lines.map(line => line.amount)) };
  const totalsByRecipient = { before: recipientTotals(before.lines), after: recipientTotals(after.lines) };

  return {
    changed: headerChanges.length > 0 || lineChanges.length > 0 || added.length > 0 || removed.length > 0,
    headerChanges,
    lineChanges,
    documents: { added, removed },
    totals,
    recipientTotals: totalsByRecipient,
  };
}
