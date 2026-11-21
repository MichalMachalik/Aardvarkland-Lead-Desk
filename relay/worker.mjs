import recordings from "./recordings.json" with {type:"json"};
import {scenarios, topics, drafts, valid} from "./logic.mjs";

const now = () => Math.floor(Date.now()/1000);
const uuid = () => crypto.randomUUID();
const response = (data, status=200) => Response.json(data,{status, headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const fail = (status,message) => {throw Object.assign(new Error(message),{status});};
const q = (env,sql,...args) => env.DB.prepare(sql).bind(...args);
const first = (env,sql,...args) => q(env,sql,...args).first();
const run = (env,sql,...args) => q(env,sql,...args).run();
const list = async (env,sql,...args) => (await q(env,sql,...args).all()).results;
const event = (env,id,key,detail) => q(env,"INSERT OR IGNORE INTO events VALUES (?,?,?,?)",id,key,detail,now());
const bearer = request => (request.headers.get("Authorization")||"").replace(/^Bearer /,"");
async function hash(value) {
  const data=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(data),x=>x.toString(16).padStart(2,"0")).join("");
}
async function heartbeat(env) {
  return (await first(env,"SELECT heartbeat FROM fleet WHERE id=1")).heartbeat >= now()-32;
}
async function snapshot(env,owner) {
  const records=await list(env,`SELECT r.id,r.scenario,r.created,o.analysis,o.ready,t.title AS task,m.body,m.sent
    FROM requests r LEFT JOIN opportunities o ON o.id=r.id LEFT JOIN tasks t ON t.request_id=r.id
    LEFT JOIN mailbox m ON m.request_id=r.id WHERE r.owner=? ORDER BY r.created DESC,r.rowid DESC`,owner);
  for(const r of records) {
    if(r.analysis) {r.analysis=JSON.parse(r.analysis); r.drafts=drafts(r.analysis);}
    if(env.PRIVATE) r.input=await first(env,"SELECT company,subject,message,email FROM inputs WHERE id=?",r.id);
  }
  const runs=await list(env,`SELECT a.id,a.request_id,a.status,a.engine,a.execution,a.reason,a.operation,a.created FROM runs a
    JOIN requests r ON r.id=a.request_id WHERE r.owner=? ORDER BY a.created DESC,a.rowid DESC LIMIT 30`,owner);
  const events=await list(env,`SELECT e.* FROM events e JOIN runs a ON a.id=e.run_id JOIN requests r ON r.id=a.request_id
    WHERE r.owner=? AND a.id IN (SELECT a2.id FROM runs a2 JOIN requests r2 ON r2.id=a2.request_id WHERE r2.owner=? ORDER BY a2.created DESC,a2.rowid DESC LIMIT 30) ORDER BY e.at,e.rowid`,owner,owner);
  return {records,runs:runs.map(r=>({...r,steps:events.filter(e=>e.run_id===r.id)})),online:await heartbeat(env),private:!!env.PRIVATE};
}
async function guardBody(request) {
  if(!request.headers.get("Content-Type")?.includes("application/json")) fail(415,"Je vyžadován JSON.");
  const text=await request.text(); if(text.length>6000) fail(413,"Příliš dlouhé zadání.");
  try {return JSON.parse(text);} catch {fail(400,"Neplatný JSON.");}
}
const catalog = (id) => Object.hasOwn(scenarios,id);
async function inputFor(env,r) {
  if(env.PRIVATE) return first(env,"SELECT company,subject,message,email FROM inputs WHERE id=?",r.request_id);
  return {scenario:r.scenario};
}
async function work(env,r,step,data={}) {
  const ts=now(), id=r.request_id;
  const existing=await first(env,"SELECT * FROM opportunities WHERE id=?",id);
  if(step==="load") {
    await env.DB.batch([event(env,r.id,"load","Poptávka přijata"),q(env,"UPDATE runs SET execution=COALESCE(execution,?),updated=? WHERE id=?",String(data.execution||"").slice(0,40),ts,r.id)]);
    return {duplicate:r.operation==="submit" && !!existing?.ready,input:await inputFor(env,r),operation:r.operation};
  }
  if(step==="duplicate"){
    if(!existing?.ready) fail(409,"Původní záznam se ještě zpracovává.");
    await env.DB.batch([event(env,r.id,"duplicate","Vrácena existující příležitost"),q(env,"UPDATE runs SET status='done',ticket=NULL,updated=? WHERE id=?",ts,r.id)]);
    return {ok:true};
  }
  if(step==="crm") {
    const a=data.analysis;
    if(!valid(a)) fail(422,"Nepodařilo se ověřit výsledek klasifikace.");
    if(!env.PRIVATE){
      const ref=recordings.results[r.scenario];
      if(a.intent!==ref.intent || a.weekly!==ref.weekly || a.deadline!==ref.deadline) fail(422,"Výsledek nesouhlasí s podklady případu.");
    }
    await env.DB.batch([event(env,r.id,"classify",r.engine==="n8n"?"Zprávu zpracoval místní model":"Načten uložený výsledek modelu"),
      q(env,"INSERT OR IGNORE INTO opportunities(id,analysis,created) VALUES(?,?,?)",id,JSON.stringify(a),ts),
      event(env,r.id,"crm",existing?"Nalezena již uložená příležitost":"Příležitost uložena do CRM")]);
    if(r.fault) return {status:503,message:"CRM po uložení nepotvrdilo zápis."};
    return {status:200};
  }
  if(step==="interrupted" || step==="failure") {
    const msg=step==="interrupted"?"CRM nevrátilo potvrzení zápisu. Obnovte spojení a opakujte.":"Zpracování se přerušilo. Záznam lze znovu zpracovat.";
    await env.DB.batch([event(env,r.id,step,msg),q(env,"UPDATE runs SET status='failed',reason=?,ticket=NULL,updated=? WHERE id=?",msg,ts,r.id)]);
    return {ok:true};
  }
  if(step==="handover") {
    if(!existing) fail(409,"Chybí příležitost.");
    const a=JSON.parse(existing.analysis);
    await env.DB.batch([q(env,"INSERT OR IGNORE INTO tasks VALUES(?,?)",id,a.intent==="unknown"?"Upřesnit zadání":"Kontaktovat zájemce"),
      q(env,"UPDATE opportunities SET ready=1 WHERE id=?",id),event(env,r.id,"handover","Úkol a návrh odpovědi připraveny"),
      q(env,"UPDATE runs SET status='done',ticket=NULL,updated=? WHERE id=?",ts,r.id)]);
    return {ok:true};
  }
  if(step==="approve") {
    if(!existing?.ready) fail(409,"Návrh ještě není připraven.");
    const msg=env.PRIVATE && r.variant.startsWith("text:")?r.variant.slice(5):drafts(JSON.parse(existing.analysis))[Number(r.variant)];
    const prior=await first(env,"SELECT body FROM mailbox WHERE request_id=?",id);
    if(env.deliver && !prior) await env.deliver(id,msg);
    await env.DB.batch([q(env,"INSERT OR IGNORE INTO mailbox VALUES(?,?,?)",id,msg,ts),event(env,r.id,"approve",prior?"Odpověď už byla schválena":env.PRIVATE?"Odpověď schválena":"Odpověď uložena do testovací schránky"),
      q(env,"UPDATE runs SET status='done',ticket=NULL,updated=? WHERE id=?",ts,r.id)]);
    return {ok:true};
  }
  fail(404,"Neznámý krok.");
}
async function cloud(env,r) {
  try{
    const start=await work(env,r,"load",{execution:"cloud-"+r.id.slice(0,8)});
    if(r.operation==="approve") return await work(env,r,"approve");
    if(start.duplicate) return await work(env,r,"duplicate");
    const result=await work(env,r,"crm",{analysis:recordings.results[r.scenario]});
    return await work(env,r,result.status===503?"interrupted":"handover");
  }catch(e){await work(env,r,"failure");throw e;}
}
async function action(env,owner,data){
  const ts=now(), mode=env.PRIVATE?"n8n":data.mode;
  if(!["n8n","cloud"].includes(mode)||!["submit","approve"].includes(data.operation)) fail(400,"Neplatná operace.");
  if(mode==="n8n" && !await heartbeat(env)) fail(503,"Živé n8n je právě offline.");
  const scenario=data.scenario, privateInput=env.PRIVATE && data.input;
  if(env.PRIVATE ? typeof scenario!=="string" || !/^[a-zA-Z0-9_-]{8,70}$/.test(scenario) : !catalog(scenario)) fail(400,"Neplatný případ.");
  let req=await first(env,"SELECT * FROM requests WHERE owner=? AND scenario=?",owner,scenario);
  if(!req){
    if(data.operation!=="submit") fail(409,"Nejprve odešlete poptávku.");
    const id=uuid();
    const writes=[q(env,"INSERT OR IGNORE INTO requests VALUES(?,?,?,?)",id,owner,scenario,ts)];
    if(env.PRIVATE){
      if(!privateInput || !["company","subject","message","email"].every(k=>typeof privateInput[k]==="string" && privateInput[k].trim() && privateInput[k].length<=(k==="message"?2000:160)) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privateInput.email)) fail(400,"Vyplňte firmu, kontakt, předmět a zprávu.");
      writes.push(q(env,"INSERT OR IGNORE INTO inputs SELECT id,?,?,?,? FROM requests WHERE id=?",privateInput.company.trim(),privateInput.subject.trim(),privateInput.message.trim(),privateInput.email.trim(),id));
    }
    await env.DB.batch(writes); req=await first(env,"SELECT * FROM requests WHERE owner=? AND scenario=?",owner,scenario);
  }
  if(data.operation==="approve" && !(await first(env,"SELECT ready FROM opportunities WHERE id=?",req.id))?.ready) fail(409,"Není připraven návrh ke schválení.");
  const variant=env.PRIVATE && typeof data.draft==="string" && data.draft.trim() && data.draft.length<=1800?"text:"+data.draft.trim():data.variant===1?"1":"0";
  const id=uuid(), ticket=mode==="cloud"?uuid():null;
  const result=await run(env,`INSERT OR IGNORE INTO runs(id,request_id,operation,fault,variant,status,engine,ticket,created,updated)
     SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM runs WHERE created>?)<160 AND
     (SELECT count(*) FROM runs a JOIN requests r ON r.id=a.request_id WHERE r.owner=? AND a.created>?)<24`,
     id,req.id,data.operation,Number(!env.PRIVATE && data.fault===true),variant,mode==="cloud"?"running":"queued",mode,ticket,ts,ts,ts-60,owner,ts-60);
  if(!result.meta.changes){
    const active=await first(env,"SELECT id FROM runs WHERE request_id=? AND status IN ('running','queued')",req.id);
    if(active) return {run:active.id,request:req.id};
    fail(429,"Dosáhli jste limitu průchodů. Zkuste to za minutu.");
  }
  if(mode==="cloud") await cloud(env,{id,request_id:req.id,operation:data.operation,scenario,engine:mode,variant,fault:data.fault===true});
  return {run:id,request:req.id};
}
async function expire(env) {
  await run(env,`UPDATE runs SET status='failed',ticket=NULL,reason='Zpracování vypršelo. Opakujte požadavek.',updated=?
    WHERE status IN ('queued','running') AND updated<?`,now(),now()-150);
}
async function handle(request,env){
  const url=new URL(request.url),path=url.pathname, token=bearer(request);
  if(request.method==="GET" && path==="/health") return response({ok:true,online:await heartbeat(env)});
  if(["/engine/lease","/engine/heartbeat"].includes(path) && request.method==="POST"){
    if(!env.ENGINE_KEY || token!==env.ENGINE_KEY) fail(403,"Přístup odepřen.");
    await run(env,"UPDATE fleet SET heartbeat=? WHERE id=1 AND heartbeat<?",now(),now()-10);
    if(path==="/engine/heartbeat") return response({ok:true});
    const r=await first(env,"SELECT id FROM runs WHERE status='queued' AND engine='n8n' AND updated>? ORDER BY created,rowid LIMIT 1",now()-150);
    if(!r) return response({job:null});
    const t=uuid()+uuid();
    const claimed=await run(env,"UPDATE runs SET status='running',ticket=?,updated=? WHERE id=? AND status='queued'",t,now(),r.id);
    return response({job:claimed.meta.changes?{run:r.id,ticket:t}:null});
  }
  if(path.startsWith("/engine/step/") && request.method==="POST"){
    if(token.length!==72) fail(403,"Přístup odepřen.");
    const data=await guardBody(request);
    const r=await first(env,"SELECT a.*,r.scenario FROM runs a JOIN requests r ON r.id=a.request_id WHERE a.id=? AND a.ticket=? AND a.status='running' AND a.updated>?",String(data.run),token,now()-150);
    if(!r) fail(409,"Průchod vypršel.");
    const v=await work(env,r,path.slice(13),data); return response(v,v.status||200);
  }
  if(!["/v1/state","/v1/action"].includes(path)) fail(404,"Neznámá cesta.");
  if(!/^[a-f0-9]{64}$/.test(token)) fail(401,"Chybí pracovní prostor.");
  const owner=await hash(token);
  if(path==="/v1/action" && request.method==="POST"){await expire(env); return response(await action(env,owner,await guardBody(request)),202);}
  if(path==="/v1/state" && request.method==="GET"){
    const stale=await first(env,`SELECT a.id FROM runs a JOIN requests r ON r.id=a.request_id WHERE r.owner=? AND a.status IN ('running','queued') AND a.updated<? LIMIT 1`,owner,now()-150);
    if(stale) await expire(env);
    return response(await snapshot(env,owner));
  }
  fail(405,"Nepodporovaná metoda.");
}
export default {
  async fetch(request,env){
    let res;
    try{res=request.method==="OPTIONS"?new Response(null,{status:204}):await handle(request,env);}
    catch(e){res=response({error:e.status?e.message:"Služba je dočasně nedostupná."},e.status||500); if(!e.status)console.error(e.name,e.message);}
    res.headers.set("Access-Control-Allow-Origin","https://michalmachalik.github.io");
    res.headers.set("Access-Control-Allow-Headers","Authorization, Content-Type");
    res.headers.set("Access-Control-Allow-Methods","POST, GET, OPTIONS");
    return res;
  },
  async scheduled(_,env){await expire(env);await run(env,"DELETE FROM requests WHERE created<?",now()-172800);}
};
