const privateMode=document.documentElement.dataset.deployment==="private";
const api=privateMode?location.origin:"https://aardvarkland-lead-desk.dso-activation.workers.dev";
const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const icon=name=>'<svg aria-hidden="true"><use href="#'+name+'"/></svg>';
const time=t=>new Date(t*1000).toLocaleTimeString("cs-CZ",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
const views={poptavky:["Poptávky","Příjem zpráv, vyhodnocení a předání obchodu."],crm:["CRM","Příležitosti a další krok pro obchodníka."],schranka:["Schránka",privateMode?"Schválené odpovědi z pracovního prostoru.":"Schválené odpovědi v testovací schránce."],historie:["Historie","Průběh jednotlivých zpracování."]};
const topics={crm:"Předávání poptávek do CRM",booking:"Potvrzování rezervací",unknown:"Upřesnění požadavku"};
const deadlines={this_month:"Tento měsíc",next_month:"Příští měsíc",unknown:"Neuvedeno"};
const statuses={done:"Dokončeno",failed:"Přerušeno",running:"Probíhá",queued:"Ve frontě"};
let session, scenarios=[], state={records:[],runs:[],online:false}, selected=privateMode?null:"crm", mode=privateMode?"n8n":"cloud", busy=false, fault=false, variant=0, privateDraft="", privateForm={}, mounted=false;
let timer, syncing=false;
function space(fresh=false){
  const key="lead-desk.space.v1."+mode;
  let token=localStorage.getItem(key);
  if(fresh || !/^[a-f0-9]{64}$/.test(token||"")){
    token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,"0")).join("");localStorage.setItem(key,token);
  }
  return token;
}
function page(){const tab=location.hash.slice(1);return Object.hasOwn(views,tab)?tab:"poptavky";}
function record(){return state.records.find(r=>r.scenario===selected);}
function dataFor(r){return r.input || scenarios.find(s=>s.id===r.scenario)||{};}
function message(e=""){ $("error").hidden=!e;$("error").textContent=e;}
function badge(text,style=""){return '<span class="badge '+style+'">'+esc(text)+'</span>';}
function button(label,id,primary=false,disabled=false,symbol=""){return '<button type="button" data-action="'+id+'" '+(primary?'class="primary" ':'')+(disabled?'disabled ':'')+'>'+(symbol?icon(symbol):"")+esc(label)+'</button>';}
async function call(path,body){
  const r=await fetch(api+path,{method:body?"POST":"GET",headers:{"Authorization":"Bearer "+session,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store",signal:AbortSignal.timeout(25000)});
  const d=await r.json();if(!r.ok)throw Error(d.error||"Spojení se nezdařilo.");return d;
}
function active(){return state.runs.some(r=>r.status==="queued"||r.status==="running");}
async function refresh(){
  if(syncing)return;syncing=true;
  const previous=session;
  try{const result=await call("/v1/state");if(previous!==session)return;state=result;mounted=true;render();message();}
  catch(e){message("Pracovní prostor se nepodařilo načíst. "+e.message);if(!mounted)$("view").innerHTML=button("Zkusit znovu","refresh");}
  finally{syncing=false;clearTimeout(timer);if(previous!==session)timer=setTimeout(refresh,0);else if(active()||!mounted)timer=setTimeout(refresh,2000);}
}
function section(title,symbol,content,tail=""){return '<section class="panel"><div class="section-title"><h2>'+icon(symbol)+esc(title)+'</h2>'+tail+'</div>'+content+'</section>';}
function latest(r){return state.runs.find(x=>x.request_id===r?.id);}
function timeline(run){
  if(!run)return '<p class="empty">Po odeslání zde uvidíte jednotlivé kroky zpracování.</p>';
  const rows=run.steps.map(s=>'<li>'+icon(["failure","interrupted"].includes(s.step)?"warn":"check")+'<span>'+esc(s.detail)+'</span><small>'+time(s.at)+'</small></li>').join("");
  const engine=run.engine==="cloud"?"Cloudové preview · uložená klasifikace":"n8n · živý průchod";
  return '<div class="row">'+badge(statuses[run.status],run.status==="failed"?"err":"")+'<span class="subtle">'+esc(engine)+'</span></div><ul class="rows steps">'+rows+'</ul>'+(run.reason?'<p class="notice err">'+esc(run.reason)+'</p>':"")+'<p class="info">'+(run.execution?'Průchod '+esc(run.execution):'Čeká na zpracování')+'</p>';
}
function crmDetail(r){
  if(!r?.analysis)return '<p class="empty">Po vyhodnocení zprávy se zde objeví příležitost a úkol pro obchodníka.</p>';
  const a=r.analysis, sealed=Boolean(r.sent);
  return '<div class="row"><h3>'+esc(dataFor(r).company)+'</h3>'+badge(sealed?"Odpověď schválena":!r.ready?"Čeká na obnovu":a.intent==="unknown"?"Čeká na upřesnění":"K předání",!r.ready||a.intent==="unknown"?"warn":"")+'</div>'+
    '<dl class="facts"><dt>Příležitost</dt><dd>'+esc(r.id.slice(0,8).toUpperCase())+'</dd><dt>Potřeba</dt><dd>'+esc(topics[a.intent])+'</dd><dt>Objem za týden</dt><dd>'+esc(a.weekly??"Neuvedeno")+'</dd><dt>Termín</dt><dd>'+esc(deadlines[a.deadline])+'</dd><dt>Úkol</dt><dd>'+esc(r.task||"Čeká na potvrzení CRM")+'</dd></dl>'+
    (!r.ready?"":sealed?'<div class="draft"><h3>Schválená odpověď</h3><p>'+esc(r.body)+'</p></div>':'<div class="draft"><h3>Návrh odpovědi</h3>'+(privateMode?'<textarea id="draft" aria-label="Text odpovědi" rows="4">'+esc(privateDraft||r.drafts[0])+'</textarea>':'<label class="field">Znění odpovědi<select id="variant"><option value="0" '+(!variant?"selected":"")+'>Stručně</option><option value="1" '+(variant?"selected":"")+'>S vysvětlením</option></select></label><p>'+esc(r.drafts[variant])+'</p>')+button(privateMode?"Schválit odpověď":"Schválit do testovací schránky","approve",false,busy||active(),"mail")+'</div>');
}
function inputForm(){
  const field=(name,label,type="text",limit=160)=>'<label class="field">'+label+'<input type="'+type+'" maxlength="'+limit+'" name="'+name+'" value="'+esc(privateForm[name]||"")+'" required></label>';
  return '<form id="private-form"><div class="fields">'+field("company","Firma")+field("email","Kontaktní e-mail","email")+field("subject","Předmět")+'<label class="field full">Zpráva<textarea name="message" maxlength="2000" required rows="3">'+esc(privateForm.message||"")+'</textarea></label></div><div class="actions"><span class="subtle">Soukromý pracovní prostor · n8n</span><button class="primary" '+(busy||active()?"disabled":"")+'>'+icon("play")+'Zpracovat poptávku</button></div></form>';
}
function intake(){
  const r=record(), last=latest(r), blocked=busy||active();
  if(privateMode && !selected)return section("Nová poptávka","inbox",inputForm());
  const info=r?dataFor(r):scenarios.find(s=>s.id===selected)||{};
  const cases=scenarios.map(s=>'<option value="'+s.id+'" '+(s.id===selected?"selected":"")+'>'+esc(s.subject)+'</option>').join("");
  const pick=privateMode?"":'<div class="fields"><label class="field">Poptávka<select id="scenario">'+cases+'</select></label><label class="field">Zpracování<select id="mode"><option value="cloud" '+(mode==="cloud"?"selected":"")+'>Cloudové preview</option><option value="n8n" '+(mode==="n8n"?"selected":"")+'>Živý průchod v n8n</option></select></label></div>';
  const label=last?.status==="failed"?"Obnovit spojení a opakovat":r?"Odeslat znovu":"Zpracovat poptávku";
  const ctl=button(label,"submit",true,blocked || (mode==="n8n" && !state.online),"play");
  const lock=!privateMode && (!r?.ready) && last?.status!=="failed";
  const settings=lock?'<label class="switch"><input type="checkbox" id="fault" '+(fault?"checked":"")+'>Simulovat výpadek CRM po zápisu</label>':privateMode?button("Nová poptávka","new"):'<span class="subtle">'+esc(r?.ready?"Opakování zachová číslo příležitosti.":"")+'</span>';
  return '<section class="panel">'+pick+'<div class="message"><h3>'+esc(info.company)+'</h3><p>'+esc(info.text||info.message)+'</p></div>'+(mode==="n8n"&&!state.online?'<p class="notice warn">Živý průchod je offline.'+(privateMode?" Spusťte místní službu.":" Cloudové preview je dostupné.")+'</p>':"")+'<div class="actions">'+settings+ctl+'</div></section><div class="grid">'+section("Průchod","branch",timeline(last))+section("Obchodní příležitost","crm",crmDetail(r))+'</div>';
}
function render(){
  const tab=page();$("title").textContent=views[tab][0];$("description").textContent=views[tab][1];$("crumb").textContent=views[tab][0];$("workspace").textContent=privateMode?"Soukromý prostor":"Lead Desk";
  document.querySelectorAll("nav a").forEach(a=>{if(a.hash==="#"+tab)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");});
  let html;
  if(tab==="poptavky")html=intake();
  else if(tab==="historie")html=section("Poslední průchody","history",state.runs.length?state.runs.map(r=>'<details class="entry"><summary>'+esc(dataFor(state.records.find(x=>x.id===r.request_id)).company)+' · '+(r.operation==="approve"?"Schválení":"Příjem")+' · '+time(r.created)+' · '+esc(statuses[r.status])+'</summary>'+timeline(r)+'</details>').join(""):'<p class="empty">Zatím neproběhlo žádné zpracování.</p>');
  else{
    const matches=state.records.filter(r=>tab==="crm"?r.analysis:r.sent);
    html=section(tab==="crm"?"Obchodní příležitosti":privateMode?"Schválené zprávy":"Testovací schránka",tab==="crm"?"crm":"mail",matches.length?matches.map(r=>'<article class="entry"><div class="row"><h3>'+esc(dataFor(r).company)+'</h3>'+badge(tab==="crm"?topics[r.analysis.intent]:time(r.sent))+'</div><p class="desc">'+esc(tab==="crm"?dataFor(r).subject:r.body)+'</p><button class="link" data-open="'+esc(r.scenario)+'">Otevřít poptávku</button></article>').join(""):'<p class="empty">'+(tab==="crm"?"Zpracujte první poptávku.":"Schválené odpovědi se zobrazí zde.")+'</p>');
  }
  if(tab==="historie" && !privateMode && state.runs.length)html+='<div class="actions">'+button("Nový zkušební prostor","fresh",false,busy||active())+'</div>';
  $("view").innerHTML=html;$("view").setAttribute("aria-busy",String(busy));
  if($("mode"))$("mode").disabled=busy||active();
}
async function act(operation,form){
  if(busy)return;busy=true;message();const old=latest(record());
  if(privateMode && form && !selected) selected="lead-"+crypto.randomUUID();
  render();
  try{
    const data={operation,mode,scenario:selected,variant,fault:operation==="submit"&&fault&&old?.status!=="failed",...(form?{input:form}:{}),...(privateMode&&privateDraft?{draft:privateDraft}:{})};
    const ack=await call("/v1/action",data);const result=await call("/v1/state");state=result;
    $("announce").textContent="Požadavek byl přijat.";fault=false;
    if(!result.runs.some(r=>r.id===ack.run))setTimeout(refresh,400);
  }catch(e){message(e.message);if(privateMode&&form&&!record())selected=null;}
  finally{busy=false;render();clearTimeout(timer);if(active())timer=setTimeout(refresh,1200);}
}
$("view").addEventListener("change",e=>{
  if(e.target.id==="fault")fault=e.target.checked;
  if(e.target.id==="scenario"){selected=e.target.value;variant=0;privateDraft="";fault=false;message();render();}
  if(e.target.id==="mode"){mode=e.target.value;session=space();variant=0;fault=false;state={records:[],runs:[],online:state.online};message();render();refresh();}
  if(e.target.id==="variant"){variant=Number(e.target.value);render();}
});
$("view").addEventListener("input",e=>{if(e.target.id==="draft")privateDraft=e.target.value;if(e.target.form?.id==="private-form")privateForm=Object.fromEntries(new FormData(e.target.form));});
$("view").addEventListener("submit",e=>{e.preventDefault();privateForm=Object.fromEntries(new FormData(e.target));act("submit",privateForm);});
$("view").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.open){selected=b.dataset.open;variant=0;privateDraft="";fault=false;location.hash="poptavky";render();return;}
  if(b.dataset.action==="new"){selected=null;privateForm={};privateDraft="";render();}
  if(b.dataset.action==="refresh")refresh();
  if(b.dataset.action==="fresh" && !privateMode && confirm("Začít v prázdném zkušebním prostoru?")){session=space(true);selected="crm";variant=0;fault=false;state={records:[],runs:[],online:state.online};location.hash="poptavky";refresh();}
  if(["submit","approve"].includes(b.dataset.action))act(b.dataset.action);
});
window.addEventListener("hashchange",()=>{if(mounted)render();});
try{
  session=privateMode?(await (await fetch("/v1/workspace",{cache:"no-store"})).json()).key:space();
  if(!privateMode){const s=await fetch(new URL("./scenarios.json",import.meta.url));if(!s.ok)throw Error();scenarios=await s.json();}
  await refresh();
}catch{message("Pracovní prostor vyžaduje povolené místní úložiště a dostupné soubory aplikace.");}
