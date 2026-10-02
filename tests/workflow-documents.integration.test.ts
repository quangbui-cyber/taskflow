import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = new URL(process.env.COSTFLOW_TEST_DATABASE_URL || "http://invalid/");
assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/costflow_test", "Dedicated local costflow_test URL required");
process.env.DATABASE_URL = process.env.COSTFLOW_TEST_DATABASE_URL;

test("Catalog publication: family freshness and confirmation gates", async () => {
  const { prisma } = await import("../lib/prisma");
  const { executeWorkflow, loadWorkflow } = await import("../lib/workflow/service");
  const prefix = `wf4-${randomUUID()}`;
  const ids: string[] = [];
  const act = async (actor: {id: string; role: string}, command: string, fields: Record<string,string>, upload = false) => {
    const form = new FormData(); form.set("command", command);
    for (const [key,value] of Object.entries(fields)) form.set(key,value);
    return executeWorkflow(actor, form, upload ? {name:"template.pdf",mimeType:"application/pdf",size:5,data:Buffer.from("%PDF-")} : null);
  };
  try {
    const admin = await prisma.user.create({data:{name:prefix,email:`${prefix}@example.test`,passwordHash:"unused",role:"ADMIN"}});
    const employee = await prisma.user.create({data:{name:prefix,email:`${prefix}-employee@example.test`,passwordHash:"unused",managerId:admin.id}});
    ids.push(admin.id, employee.id);
    const fields = {kind:"PROPOSAL_ADVANCE",name:prefix,category:"Thử nghiệm",purpose:"Mục đích thử",instructions:"Hướng dẫn thử",signerNames:"Test",ownerId:admin.id,accountantId:admin.id,ceoId:admin.id,requirements:JSON.stringify({schemaVersion:1,requiredFields:["content"],requiredDocuments:[]})};
    const publish = async (parentTemplateId = "") => {
      const id = (await act(admin,"SAVE_TEMPLATE",{...fields,parentTemplateId,changeNote:parentTemplateId ? "Sửa hướng dẫn" : ""},true)).templateId!;
      const current = () => prisma.workflowTemplate.findUniqueOrThrow({where:{id}});
      await assert.rejects(()=>act(employee,"PUBLISH_TEMPLATE",{templateId:id,version:String(0)}));
      await act(admin,"CONFIRM_TEMPLATE",{templateId:id,version:String((await current()).revision)});
      await act(admin,"PUBLISH_TEMPLATE",{templateId:id,version:String((await current()).revision)});
      return current();
    };
    const a = await publish(); const b = await publish();
    const oldId=(await act(employee,"SAVE_DOCUMENT",{templateId:a.id,title:prefix,content:"Old content",amount:"10000000"},true)).requestId!;
    const before=await prisma.workflowRequest.findUniqueOrThrow({where:{id:oldId}});
    const a2 = await publish(a.id);
    assert.deepEqual(await prisma.workflowRequest.findUniqueOrThrow({where:{id:oldId}}),before);
    await assert.rejects(()=>act(employee,"SAVE_DOCUMENT",{requestId:oldId,version:String(before.version),templateId:a2.id,title:prefix}),/Không đổi mẫu/);
    await act(employee,"SAVE_DOCUMENT",{requestId:oldId,version:String(before.version),templateId:a.id,title:prefix,content:"Still editable"});
    const saved=await prisma.workflowRequest.findUniqueOrThrow({where:{id:oldId}});
    assert.equal(saved.state,"DRAFT"); assert.equal(saved.templateId,a.id);
    await assert.rejects(()=>act(employee,"SUBMIT_DOCUMENT",{requestId:oldId,version:String(saved.version)}),/phiên bản mới/);
    const blankId=(await act(employee,"SAVE_DOCUMENT",{templateId:a2.id,title:"New blank"})).requestId!;
    const blank=await prisma.workflowRequest.findUniqueOrThrow({where:{id:blankId}});
    assert.equal(blank.parentId,null); assert.equal(blank.projectId,null);
    const blankBody=blank.payload as unknown as import("../lib/workflow/documents").DocumentPayload;
    for(const key of ["content","counterparty","amount","linkedRequestId","mainFileId"] as const) assert.equal(blankBody[key],"");
    assert.deepEqual(blankBody.supportingFiles,{}); assert.equal(blankBody.signature,undefined);
    await assert.rejects(()=>act(employee,"SAVE_DOCUMENT",{templateId:a.id,title:"Obsolete new"}),/phiên bản hiện tại/);
    assert.equal(a2.familyId,a.familyId); assert.notEqual(a.familyId,b.familyId);
    assert.equal(a.version,1); assert.equal(b.version,1); assert.equal(a2.version,2);
    const draft = (await act(admin,"SAVE_TEMPLATE",{...fields,parentTemplateId:b.id,changeNote:"Nháp"})).templateId!;
    const list = await loadWorkflow(employee);
    assert.deepEqual(list.templates.filter(t=>t.name===prefix).map(t=>t.id).sort(),[a2.id,b.id].sort());
    assert.ok(!list.templates.some(t=>t.id===draft));
    const currentDraft = await prisma.workflowTemplate.findUniqueOrThrow({where:{id:draft}});
    await act(admin,"CONFIRM_TEMPLATE",{templateId:draft,version:String(currentDraft.revision)});
    await act(admin,"SAVE_TEMPLATE",{...fields,templateId:draft,version:String(currentDraft.revision+1),changeNote:"Sửa lại"});
    assert.equal((await prisma.workflowTemplate.findUniqueOrThrow({where:{id:draft}})).ownerConfirmedAt,null);
    await assert.rejects(()=>act(admin,"PUBLISH_TEMPLATE",{templateId:draft,version:String(currentDraft.revision+2)}),/owner/);
    const race = await Promise.allSettled([act(admin,"SAVE_TEMPLATE",{...fields,parentTemplateId:b.id}),act(admin,"SAVE_TEMPLATE",{...fields,parentTemplateId:b.id})]);
    assert.ok(race.some(r=>r.status==='fulfilled'));
    const versions = await prisma.workflowTemplate.findMany({where:{familyId:b.familyId}});
    assert.equal(new Set(versions.map(t=>t.version)).size,versions.length);
    const {downloadWorkflowFile}=await import("../lib/workflow/service");
    const unpublished = await prisma.workflowTemplate.findUniqueOrThrow({where:{id:draft}});
    // Its inherited file is published, but new unpublished bytes remain private.
    await act(admin,"SAVE_TEMPLATE",{...fields,templateId:draft,version:String(unpublished.revision),changeNote:"Thử file"},true);
    const hidden = await prisma.workflowTemplate.findUniqueOrThrow({where:{id:draft}});
    assert.equal(await downloadWorkflowFile(hidden.fileId!,employee),null);
    assert.equal(a2.category,fields.category); assert.equal(a2.purpose,fields.purpose);
  } finally {
    const requests=await prisma.workflowRequest.findMany({where:{creatorId:{in:ids}},select:{id:true}});
    const requestIds=requests.map(r=>r.id);
    await prisma.workflowHistory.deleteMany({where:{requestId:{in:requestIds}}});await prisma.workflowFile.deleteMany({where:{requestId:{in:requestIds}}});await prisma.workflowRequest.deleteMany({where:{id:{in:requestIds}}});
    const templates = await prisma.workflowTemplate.findMany({where:{createdBy:{in:ids}},select:{id:true}});
    await prisma.workflowFile.deleteMany({where:{templateId:{in:templates.map(t=>t.id)}}});
    await prisma.workflowTemplate.deleteMany({where:{id:{in:templates.map(t=>t.id)}}});
    await prisma.user.deleteMany({where:{id:{in:ids}}}); await prisma.$disconnect();
  }
});

test("Submission history: 10/12 million original bytes, late references, lineage authorization and legacy gap",async()=>{
  const {prisma}=await import("../lib/prisma");const {executeWorkflow,downloadWorkflowFile}=await import("../lib/workflow/service");const {loadSubmissionView}=await import("../lib/workflow/submissions");
  const prefix=`wf4-history-${randomUUID()}`;const ids:string[]=[];const requestIds:string[]=[];
  const act=async(actor:{id:string;role:string},command:string,fields:Record<string,string>,bytes?:string)=>{const f=new FormData();f.set("command",command);for(const[k,v]of Object.entries(fields))f.set(k,v);return executeWorkflow(actor,f,bytes?{name:"same-name.pdf",mimeType:"application/pdf",size:Buffer.byteLength(bytes),data:Buffer.from(bytes)}:null);};
  try{
    const mk=async(label:string,role="USER",managerId?:string)=>{const u=await prisma.user.create({data:{name:prefix,email:`${prefix}-${label}@example.test`,passwordHash:"unused",role,managerId}});ids.push(u.id);return u;};
    const admin=await mk("admin","ADMIN");const creator=await mk("creator","USER",admin.id);const stranger=await mk("stranger");
    const template=await prisma.workflowTemplate.create({data:{familyId:randomUUID(),version:1,kind:"PROPOSAL",name:prefix,createdBy:admin.id,ownerId:admin.id,accountantId:admin.id,ceoId:admin.id,signerNames:"Test",instructions:"Test only",publishedAt:new Date(),requirements:{schemaVersion:1,requiredFields:["amount"],requiredDocuments:[]}}});
    const fields={templateId:template.id,title:prefix,amount:"10000000"};
    const first=(await act(creator,"SAVE_DOCUMENT",fields,"%PDF-replaced")).requestId!;requestIds.push(first);
    const req=(id:string)=>prisma.workflowRequest.findUniqueOrThrow({where:{id}});
    const run=async(id:string,actor:typeof creator,command:string,fields:Record<string,string>={},bytes?:string)=>act(actor,command,{requestId:id,version:String((await req(id)).version),...fields},bytes);
    const replaced=((await req(first)).payload as unknown as import("../lib/workflow/documents").DocumentPayload).mainFileId;
    await run(first,creator,"SAVE_DOCUMENT",fields,"%PDF-first-10000000");await run(first,creator,"SUBMIT_DOCUMENT");
    const original=(await req(first)).payload as unknown as import("../lib/workflow/documents").DocumentPayload;
    await run(first,creator,"ADD_REFERENCE",{},"%PDF-late-reference");await run(first,admin,"DECIDE_DOCUMENT",{decision:"RETURN",reason:"Test return"});
    const second=(await act(creator,"SAVE_DOCUMENT",{...fields,amount:"12000000",parentRequestId:first},"%PDF-second-12000000")).requestId!;requestIds.push(second);await run(second,creator,"SUBMIT_DOCUMENT");
    const current=await loadSubmissionView(second,undefined,creator);assert.equal(current!.historical,false);assert.equal(current!.attempts.length,2);
    const old=await loadSubmissionView(second,current!.attempts[0].id,creator);const newer=await loadSubmissionView(first,current!.attempts[1].id,creator);
    assert.equal((old!.detail.request.payload as unknown as import("../lib/workflow/documents").DocumentPayload).amount,"10000000");assert.equal((newer!.detail.request.payload as unknown as import("../lib/workflow/documents").DocumentPayload).amount,"12000000");
    assert.ok(!old!.detail.request.files.some(f=>f.id===replaced));assert.equal(old!.legacyMissingManifest,false);
    assert.equal(original.submittedFiles!.referenceFileIds.length,0);assert.equal(old!.detail.request.files.filter(f=>f.kind==="REFERENCE").length,1);
    const oldDownload=await downloadWorkflowFile((old!.detail.request.payload as unknown as import("../lib/workflow/documents").DocumentPayload).mainFileId,creator);const newDownload=await downloadWorkflowFile((newer!.detail.request.payload as unknown as import("../lib/workflow/documents").DocumentPayload).mainFileId,creator);
    assert.equal(Buffer.from(oldDownload!.data).toString(),"%PDF-first-10000000");assert.equal(Buffer.from(newDownload!.data).toString(),"%PDF-second-12000000");assert.notEqual(oldDownload!.sha256,newDownload!.sha256);
    assert.equal(await loadSubmissionView(second,"forged",creator),null);assert.equal(await loadSubmissionView(second,current!.attempts[0].id,stranger),null);assert.equal(await downloadWorkflowFile(original.mainFileId,stranger),null);
    assert.ok(await loadSubmissionView(second,current!.attempts[0].id,admin));
    await prisma.user.update({where:{id:creator.id},data:{isActive:false}});await assert.rejects(()=>loadSubmissionView(second,current!.attempts[0].id,creator),/hoạt động/);await prisma.user.update({where:{id:creator.id},data:{isActive:true}});
    const history=await prisma.workflowHistory.findUniqueOrThrow({where:{id:current!.attempts[0].id}});const snapshot=history.snapshot as unknown as {payload:import("../lib/workflow/documents").DocumentPayload};delete snapshot.payload.submittedFiles;
    await prisma.workflowHistory.update({where:{id:history.id},data:{snapshot:JSON.parse(JSON.stringify(snapshot))}});
    const legacy=await loadSubmissionView(second,history.id,creator);assert.equal(legacy!.legacyMissingManifest,true);assert.ok(!legacy!.detail.request.files.some(f=>f.kind==="MAIN"));
  }finally{await prisma.workflowDecision.deleteMany({where:{requestId:{in:requestIds}}});await prisma.workflowHistory.deleteMany({where:{requestId:{in:requestIds}}});await prisma.workflowFile.deleteMany({where:{requestId:{in:requestIds}}});await prisma.workflowRequest.deleteMany({where:{id:{in:requestIds}}});await prisma.workflowTemplate.deleteMany({where:{createdBy:{in:ids}}});await prisma.user.deleteMany({where:{id:{in:ids}}});await prisma.$disconnect();}
});

test("Draft supporting documents: persisted minimum draft, strict slots and server bypass rejection", async () => {
  const {prisma} = await import("../lib/prisma");
  const {executeWorkflow,loadDocument,downloadWorkflowFile} = await import("../lib/workflow/service");
  const prefix = `wf4-draft-${randomUUID()}`; const ids:string[]=[]; const requestIds:string[]=[];
  const proof={name:"proof.pdf",mimeType:"application/pdf",size:5,data:Buffer.from("%PDF-")};
  const act=async(actor:{id:string;role:string},command:string,fields:Record<string,string>,upload:typeof proof|null=null)=>{const f=new FormData();f.set("command",command);for(const[k,v]of Object.entries(fields))f.set(k,v);return executeWorkflow(actor,f,upload);};
  try {
    const admin=await prisma.user.create({data:{name:prefix,email:`${prefix}@example.test`,passwordHash:"unused",role:"ADMIN"}});ids.push(admin.id);
    const creator=await prisma.user.create({data:{name:prefix,email:`${prefix}-creator@example.test`,passwordHash:"unused",managerId:admin.id}});ids.push(creator.id);
    const t=await prisma.workflowTemplate.create({data:{familyId:randomUUID(),version:1,kind:"PROPOSAL_ADVANCE",name:prefix,createdBy:admin.id,ownerId:admin.id,accountantId:admin.id,ceoId:admin.id,signerNames:"Test",instructions:"Test only",publishedAt:new Date(),requirements:{schemaVersion:1,requiredFields:["counterparty","amount"],requiredDocuments:[{key:"invoice",label:"Hóa đơn"}]}}});
    const fields={templateId:t.id,title:prefix};
    const id=(await act(creator,"SAVE_DOCUMENT",fields)).requestId!;requestIds.push(id);
    const req=()=>prisma.workflowRequest.findUniqueOrThrow({where:{id}});
    const run=async(command:string,extra:Record<string,string>={},upload:typeof proof|null=null)=>act(creator,command,{requestId:id,version:String((await req()).version),...extra},upload);
    assert.equal((await loadDocument(id,creator))!.request.state,"DRAFT");
    await assert.rejects(()=>run("SUBMIT_DOCUMENT",{complete:"true"}),/Đối tác.*Giá trị.*Tài liệu chính.*Hóa đơn/);
    await assert.rejects(()=>run("SAVE_DOCUMENT",{...fields,amount:"invalid"}));
    await run("SAVE_DOCUMENT",{...fields,counterparty:"Test",amount:"100.4"},proof);
    await run("ADD_REFERENCE",{},proof);
    await assert.rejects(()=>run("SUBMIT_DOCUMENT"),/Hóa đơn/);
    await assert.rejects(()=>run("ADD_SUPPORTING_DOCUMENT",{supportingSlot:"foreign"},proof),/Vị trí/);
    await assert.rejects(()=>run("ADD_SUPPORTING_DOCUMENT",{supportingSlot:"invoice"},{...proof,size:4*1024*1024+1}),/4 MB/);
    await run("ADD_SUPPORTING_DOCUMENT",{supportingSlot:"invoice"},proof);
    const original=(await req()).payload as unknown as import("../lib/workflow/documents").DocumentPayload;
    const first=original.supportingFiles!.invoice;
    await run("ADD_SUPPORTING_DOCUMENT",{supportingSlot:"invoice"},{...proof,data:Buffer.from("%PDF2")});
    assert.ok(await downloadWorkflowFile(first,creator));
    const replacement=(await req()).payload as unknown as import("../lib/workflow/documents").DocumentPayload;
    assert.notEqual(replacement.supportingFiles!.invoice,first);
    const foreign=(await act(creator,"SAVE_DOCUMENT",{...fields,title:"Foreign"},proof)).requestId!;requestIds.push(foreign);
    const foreignBody=(await prisma.workflowRequest.findUniqueOrThrow({where:{id:foreign}})).payload as unknown as import("../lib/workflow/documents").DocumentPayload;
    await prisma.workflowRequest.update({where:{id},data:{payload:{...replacement,supportingFiles:{invoice:foreignBody.mainFileId}}}});
    await assert.rejects(()=>run("SUBMIT_DOCUMENT"),/đúng hồ sơ/);
    await prisma.workflowRequest.update({where:{id},data:{payload:JSON.parse(JSON.stringify(replacement))}});
    await run("SAVE_DOCUMENT",{...fields,counterparty:"Test",amount:"100.4"});
    assert.deepEqual(((await req()).payload as unknown as import("../lib/workflow/documents").DocumentPayload).supportingFiles,replacement.supportingFiles);
    await run("SUBMIT_DOCUMENT");
    assert.equal((await req()).state,"SUBMITTED");
    await assert.rejects(()=>run("ADD_SUPPORTING_DOCUMENT",{supportingSlot:"invoice"},proof),/nháp/);
  } finally {
    await prisma.workflowHistory.deleteMany({where:{requestId:{in:requestIds}}});await prisma.workflowFile.deleteMany({where:{requestId:{in:requestIds}}});await prisma.workflowRequest.deleteMany({where:{id:{in:requestIds}}});
    await prisma.workflowTemplate.deleteMany({where:{createdBy:{in:ids}}});await prisma.user.deleteMany({where:{id:{in:ids}}});await prisma.$disconnect();
  }
});
