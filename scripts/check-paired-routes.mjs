// Dedicated local acceptance only; never reads a deployment environment file.
import fs from "node:fs";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
const database = new URL(process.env.DATABASE_URL || "http://invalid");
assert.ok(["localhost","127.0.0.1"].includes(database.hostname) && database.pathname==="/costflow_test");
assert.ok(process.env.SESSION_SECRET);
const p=new PrismaClient();
try {
  const fixture=JSON.parse(fs.readFileSync("../.planning/phases/03.1-bao-gia-ic-song-song/browser-fixture.json","utf8"));
  const base="http://127.0.0.1:3017";
  const token=async id=>new SignJWT({sessionVersion:0}).setProtectedHeader({alg:"HS256"}).setSubject(id).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  const headers={cookie:"session="+await token(fixture.actorId),origin:base};
  const root=base+"/api/projects/"+fixture.projectId+"/costflow/evidence";
  const proof=await p.costFlowEvidence.findFirstOrThrow({where:{projectId:fixture.projectId}});
  assert.equal((await fetch(root+"/"+proof.id+"/preview")).status,401);
  const image=await fetch(root+"/"+proof.id+"/preview",{headers});
  assert.equal(image.status,200);assert.equal(image.headers.get("x-frame-options"),"SAMEORIGIN");assert.equal(image.headers.get("cache-control"),"private, no-store");
  const png=Buffer.from(await image.arrayBuffer());assert.equal(png[0],137);
  const form=new FormData();form.set("proof",new File([png],"fresh-api.png",{type:"image/png"}));
  const uploaded=await fetch(root+"/upload",{method:"POST",headers,body:form});assert.equal(uploaded.status,201);
  const newProof=(await uploaded.json()).evidence;assert.equal(newProof.sha256,proof.sha256);
  assert.equal((await fetch(root+"/upload",{method:"POST",headers:{...headers,origin:"http://foreign.example"},body:form})).status,403);
  const bad=new FormData();bad.set("proof",new File(["bad"],"bad.exe",{type:"application/octet-stream"}));assert.equal((await fetch(root+"/upload",{method:"POST",headers,body:bad})).status,422);
  const large=new FormData();large.set("proof",new File([Buffer.alloc(4*1024*1024+1)],"large.txt",{type:"text/plain"}));assert.ok([413,422].includes((await fetch(root+"/upload",{method:"POST",headers,body:large})).status));
  const reviewHeaders={cookie:"session="+await token(fixture.reviewerId)};
  assert.equal((await fetch(root+"/"+proof.id+"/preview",{headers:reviewHeaders})).status,200);
  assert.equal((await fetch(root+"/"+newProof.id+"/preview",{headers:reviewHeaders})).status,404);
  assert.equal((await fetch(root+"/"+newProof.id,{headers:reviewHeaders})).status,404);
  const result={status:"PASS",assertions:13,scenarios:["401 anonymous","valid PNG bytes and SAMEORIGIN/no-store","new upload SHA256","foreign Origin 403","unsupported 422","oversized reject","assigned original preview200","unlinked upload preview/download404"]};
  fs.writeFileSync("../.planning/phases/03.1-bao-gia-ic-song-song/route-checks.json",JSON.stringify(result,null,2));console.log(result);
} finally {await p.$disconnect();}
