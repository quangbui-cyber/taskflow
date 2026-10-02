import test from "node:test";
import assert from "node:assert/strict";
import { latestPublished } from "../lib/workflow/catalog";
import { evaluateDocumentCompleteness, parseRequirements } from "../lib/workflow/requirements";
import { submittedFileIds } from "../lib/workflow/submissions";

test("Catalog latest published: independent families, draft revisions and advance variants", () => {
  const row = (id: string, familyId: string, version: number, publishedAt: string | null, kind = "PROPOSAL_ADVANCE") => ({ id, familyId, version, publishedAt, kind });
  const rows = [row("a1", "a", 1, "2026-01-01"), row("a2", "a", 2, "2026-02-01"), row("a3", "a", 3, null), row("b1", "b", 1, "2026-01-01"), row("s1", "s", 1, "2026-01-01", "PROPOSAL_ADVANCE_SETTLEMENT")];
  assert.deepEqual(latestPublished(rows).map(t => t.id).sort(), ["a2", "b1", "s1"]);
  assert.deepEqual(latestPublished([]), []);
});

test("Submission manifest: selected immutable IDs and explicit legacy gap",()=>{
  const body={content:"",amount:"",counterparty:"",linkedRequestId:"",mainFileId:"new",submittedFiles:{schemaVersion:1 as const,mainFileId:"old",supportingFiles:{invoice:"support"},referenceFileIds:["before"]}};
  assert.deepEqual(submittedFileIds(body),["old","support","before"]);
  assert.equal(submittedFileIds({...body,submittedFiles:undefined}),null);
});

test("Draft checklist: whitespace, explicit configurations and named slots", () => {
  const config = parseRequirements({schemaVersion:1,requiredFields:["counterparty","amount"],requiredDocuments:[{key:"invoice",label:"Hóa đơn"}]});
  assert.deepEqual(evaluateDocumentCompleteness(config,{counterparty:" ",amount:"",mainFileId:"",supportingFiles:{}}).map(m=>m.key),["counterparty","amount","main","invoice"]);
  assert.deepEqual(evaluateDocumentCompleteness(config,{counterparty:"Test",amount:"0",mainFileId:"main",supportingFiles:{invoice:"file"}}),[]);
  assert.deepEqual(evaluateDocumentCompleteness(parseRequirements({schemaVersion:1,requiredFields:[],requiredDocuments:[]}),{mainFileId:"main"}),[]);
  assert.throws(()=>parseRequirements({schemaVersion:1,requiredFields:["arbitrary"],requiredDocuments:[]}));
  assert.throws(()=>parseRequirements({schemaVersion:1,requiredFields:[],requiredDocuments:[{key:"a",label:"A"},{key:"a",label:"B"}]}));
});
