import http from "node:http";
import {createHmac} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {readFileSync, mkdirSync} from "node:fs";
import {resolve,dirname,extname,sep} from "node:path";
import {fileURLToPath} from "node:url";
import handler from "../relay/worker.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
const state=process.env.LEAD_STATE_DIR;
if(!state || !process.env.LEAD_ENGINE_KEY) throw Error("Set LEAD_STATE_DIR and LEAD_ENGINE_KEY");
mkdirSync(state,{recursive:true});
const db=new DatabaseSync(resolve(state,"desk.sqlite"));
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
db.exec(readFileSync(resolve(root,"relay/schema.sql"),"utf8"));
db.exec(`CREATE TABLE IF NOT EXISTS inputs(id TEXT PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,company TEXT,subject TEXT,message TEXT,email TEXT);
CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, body TEXT NOT NULL, attempted INTEGER NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);`);
function bind(sql,args){
  const stmt=db.prepare(sql);
  return {bind:(...a)=>bind(sql,a),first:()=>stmt.get(...args),all:()=>({results:stmt.all(...args)}),run:()=>({meta:stmt.run(...args)})};
}
const DB={prepare:s=>bind(s,[]),batch(stmts){
  db.exec("BEGIN IMMEDIATE");
  try{const out=stmts.map(s=>s.run());db.exec("COMMIT");return out;}
  catch(e){db.exec("ROLLBACK");throw e;}
}};
const env={PRIVATE:true,ENGINE_KEY:process.env.LEAD_ENGINE_KEY,DB};
if(process.env.RESEND_API_KEY && process.env.LEAD_FROM){
  env.deliver=async(id,body)=>{
    const recipient=db.prepare("SELECT email FROM inputs WHERE id=?").get(id).email;
    const timestamp=Math.floor(Date.now()/1000);
    db.prepare("INSERT OR IGNORE INTO deliveries(id,body,attempted) VALUES(?,?,?)").run(id,body,timestamp);
    const record=db.prepare("SELECT * FROM deliveries WHERE id=?").get(id);
    if(record.delivered) return;
    if(record.body!==body || record.attempted < timestamp-23*3600) throw Error("Delivery needs manual reconciliation");
    const res=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+process.env.RESEND_API_KEY,"Idempotency-Key":"lead-desk/"+id},
      body:JSON.stringify({from:process.env.LEAD_FROM,to:[recipient],subject:"Re: "+db.prepare("SELECT subject FROM inputs WHERE id=?").get(id).subject,text:body}),signal:AbortSignal.timeout(12000)});
    if(!res.ok) throw Error("Delivery provider unavailable");
    db.prepare("UPDATE deliveries SET delivered=1 WHERE id=?").run(id);
  };
}
const port=Number(process.env.LEAD_PORT||17965), origin="http://127.0.0.1:"+port;
const mime={".html":"text/html; charset=utf-8",".mjs":"text/javascript",".js":"text/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".woff2":"font/woff2",".txt":"text/plain"};
const docs=resolve(root,"docs");
http.createServer(async(req,res)=>{
  try{
    if(req.headers.host!==new URL(origin).host || (req.headers.origin && req.headers.origin!==origin)){res.writeHead(403).end();return;}
    const path=new URL(req.url,origin).pathname;
    if(path==="/v1/workspace" && req.method==="GET"){
      const key=createHmac("sha256",env.ENGINE_KEY).update("Lead Desk private workspace v1").digest("hex");
      res.writeHead(200,{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"}).end(JSON.stringify({key}));return;
    }
    if(path.startsWith("/engine/") || path.startsWith("/v1/") || path==="/health"){
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>10000){res.writeHead(413).end();return;} chunks.push(chunk);}
      const body=Buffer.concat(chunks);
      const request=new Request(new URL(req.url,origin),{method:req.method,headers:req.headers,...(body.length?{body}:{} )});
      const answer=await handler.fetch(request,env);
      res.writeHead(answer.status,{"content-type":"application/json","cache-control":"no-store"}).end(await answer.text()); return;
    }
    const file=resolve(docs,"."+(path==="/"?"/index.html":decodeURIComponent(path)));
    if(!file.startsWith(docs+sep) || !Object.hasOwn(mime,extname(file))){res.writeHead(404).end();return;}
    const raw=readFileSync(file);
    const content=file===resolve(docs,"index.html")?raw.toString("utf8").replace('<html lang="cs">','<html lang="cs" data-deployment="private">'):raw;
    res.writeHead(200,{"content-type":mime[extname(file)],"x-content-type-options":"nosniff","cache-control":"no-cache"}).end(content);
  }catch{res.writeHead(404).end();}
}).listen(port,"127.0.0.1",()=>console.log("Lead Desk listening on "+origin));
