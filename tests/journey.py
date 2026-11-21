"""End-to-end checks over HTTP. Only ever submits the built-in fictional cases."""
import argparse
import concurrent.futures
import json
import secrets
import time
from urllib import request, error
from pathlib import Path
import hashlib
import ssl
import certifi

def call(base, path, token, payload=None):
    headers={"Content-Type":"application/json","Authorization":"Bearer "+token,"User-Agent":"Aardvarkland-Lead-Desk/1.0"}
    req=request.Request(base+path, None if payload is None else json.dumps(payload).encode(),headers)
    try:
        with request.urlopen(req,timeout=28,context=ssl.create_default_context(cafile=certifi.where())) as res: return res.status,json.load(res)
    except error.HTTPError as e: return e.code,json.load(e)

def check(base,mode,private=False,cleanup=None):
    key=secrets.token_hex(32)
    case="qa-"+secrets.token_hex(7) if private else "crm"
    def run(op="submit",fault=False):
        payload={"mode":mode,"operation":op,"scenario":case,"variant":1,"fault":fault}
        if private: payload["input"]={"company":"Ateliér Lumen","email":"lumen@example.invalid","subject":"CRM","message":"Každý týden ručně přepisujeme asi 40 poptávek z webu do CRM. Chceme to automatizovat ještě tento měsíc."}
        status,ack=call(base,"/v1/action",key,payload)
        assert status==202,(status,ack)
        for _ in range(105):
            s,view=call(base,"/v1/state",key)
            assert s==200,(s,view)
            item=next((r for r in view["runs"] if r["id"]==ack["run"]),None)
            if item and item["status"] in ("done","failed"):return item,view
            time.sleep(1.3)
        raise AssertionError("run timed out")
    try:
        if not private:
            failed,v=run(fault=True)
            assert failed["status"]=="failed" and failed["engine"]==mode,(failed,v)
            assert len(v["records"])==1 and not v["records"][0]["ready"] and not v["records"][0]["task"]
            assert any(x["step"]=="crm" for x in failed["steps"])
            assert call(base,"/v1/action",key,{"mode":mode,"operation":"approve","scenario":case})[0]==409
        done,v=run()
        assert done["status"]=="done" and done["engine"]==mode and done["execution"],(done,v)
        r=v["records"][0]
        assert r["analysis"]["weekly"]==40 and r["ready"] and r["task"]
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            duplicates=list(pool.map(lambda _:run(),range(2)))
        for duplicate,_ in duplicates: assert duplicate["status"]=="done" and any(s["step"]=="duplicate" for s in duplicate["steps"])
        approved,v=run("approve")
        assert approved["status"]=="done" and len(v["records"])==1
        sent=v["records"][0]["sent"]; assert sent and v["records"][0]["body"]==r["drafts"][1]
        _,v=run("approve")
        assert sent==v["records"][0]["sent"]
        assert call(base,"/v1/state",secrets.token_hex(32))[1]["records"]==[]
        print(mode,base,"passed; execution",done["execution"],flush=True)
    finally:
        if cleanup:
            import sqlite3
            with sqlite3.connect(Path(cleanup)/"desk.sqlite") as db:
                db.execute("PRAGMA foreign_keys=ON")
                db.execute("DELETE FROM requests WHERE owner=?",(hashlib.sha256(key.encode()).hexdigest(),))

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("base");p.add_argument("mode",choices=["n8n","cloud"]);p.add_argument("--private",action="store_true");p.add_argument("--cleanup")
    a=p.parse_args();check(a.base,a.mode,a.private,a.cleanup)
