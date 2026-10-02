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
    const fields = {kind:"PROPOSAL_ADVANCE",name:prefix,category:"Thử nghiệm",purpose:"Mục đích thử",instructions:"Hướng dẫn thử",signerNames:"Test",ownerId:admin.id,accountantId:admin.id,ceoId:admin.id};
    const publish = async (parentTemplateId = "") => {
      const id = (await act(admin,"SAVE_TEMPLATE",{...fields,parentTemplateId,changeNote:parentTemplateId ? "Sửa hướng dẫn" : ""},true)).templateId!;
      const current = () => prisma.workflowTemplate.findUniqueOrThrow({where:{id}});
      await assert.rejects(()=>act(employee,"PUBLISH_TEMPLATE",{templateId:id,version:String(0)}));
      await act(admin,"CONFIRM_TEMPLATE",{templateId:id,version:String((await current()).revision)});
      await act(admin,"PUBLISH_TEMPLATE",{templateId:id,version:String((await current()).revision)});
      return current();
    };
    const a = await publish(); const b = await publish(); const a2 = await publish(a.id);
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
    const templates = await prisma.workflowTemplate.findMany({where:{createdBy:{in:ids}},select:{id:true}});
    await prisma.workflowFile.deleteMany({where:{templateId:{in:templates.map(t=>t.id)}}});
    await prisma.workflowTemplate.deleteMany({where:{id:{in:templates.map(t=>t.id)}}});
    await prisma.user.deleteMany({where:{id:{in:ids}}}); await prisma.$disconnect();
  }
});
