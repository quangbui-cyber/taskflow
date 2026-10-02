export const FIELD_LABELS = {content:"Nội dung đề nghị",counterparty:"Đối tác / đơn vị",amount:"Giá trị VND",linkedRequestId:"Hồ sơ liên quan"} as const;
export type RequiredField = keyof typeof FIELD_LABELS;
export type Requirements = {schemaVersion:1;requiredFields:RequiredField[];requiredDocuments:{key:string;label:string}[]};
export function parseRequirements(value: unknown): Requirements {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cấu hình yêu cầu không hợp lệ.");
  const config = value as Requirements;
  if (config.schemaVersion !== 1 || !Array.isArray(config.requiredFields) || !Array.isArray(config.requiredDocuments) || config.requiredFields.length > 4 || config.requiredDocuments.length > 20) throw new Error("Cấu hình yêu cầu không hợp lệ.");
  if (config.requiredFields.some(key => !Object.hasOwn(FIELD_LABELS,key)) || new Set(config.requiredFields).size !== config.requiredFields.length) throw new Error("Trường bắt buộc không hợp lệ.");
  if (config.requiredDocuments.some(slot => !slot || typeof slot.key !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(slot.key) || Object.hasOwn(FIELD_LABELS,slot.key) || ["main","__proto__","constructor","prototype"].includes(slot.key) || typeof slot.label !== "string" || !slot.label.trim() || slot.label.length > 120) || new Set(config.requiredDocuments.map(s=>s.key)).size !== config.requiredDocuments.length) throw new Error("Vị trí tài liệu bắt buộc không hợp lệ.");
  return {schemaVersion:1,requiredFields:[...config.requiredFields],requiredDocuments:config.requiredDocuments.map(slot=>({key:slot.key,label:slot.label.trim()}))};
}
export function effectiveRequirements(value: unknown): Requirements {
  return value == null ? {schemaVersion:1,requiredFields:["content"],requiredDocuments:[]} : parseRequirements(value);
}
export function evaluateDocumentCompleteness(config: Requirements, body: Partial<Record<RequiredField,string>> & {mainFileId?:string;supportingFiles?:Record<string,string>}) {
  const missing: {key:string;label:string}[] = config.requiredFields.filter(key => !body[key]?.trim()).map(key => ({key,label:FIELD_LABELS[key]}));
  if (!body.mainFileId?.trim()) missing.push({key:"main",label:"Tài liệu chính"});
  for (const slot of config.requiredDocuments) if (!body.supportingFiles?.[slot.key]?.trim()) missing.push({key:slot.key,label:slot.label});
  return missing;
}
