"""Outbound job dispatcher and loopback adapter for the imported n8n workflow."""
import concurrent.futures
import hmac
import json
import os
import ssl
import certifi
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from classifier import classify_message, SCENARIOS

PUBLIC = "https://aardvarkland-lead-desk.dso-activation.workers.dev"
PRIVATE = os.environ.get("LEAD_PRIVATE_URL","http://127.0.0.1:17965")
KEY = os.environ["LEAD_ENGINE_KEY"]
BASES = [PRIVATE] if os.environ.get("LEAD_PRIVATE_ONLY") == "1" else [PRIVATE, PUBLIC]
WEBHOOK = "http://127.0.0.1:17963/webhook/lead-desk-v1"
jobs = {}
lock = threading.Lock()

def post(url, data, token="", timeout=15):
    headers = {"Content-Type":"application/json", "Authorization": "Bearer " + token, "User-Agent":"Aardvarkland-Lead-Desk/1.0"}
    req = urllib.request.Request(url, json.dumps(data,ensure_ascii=False).encode(),headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context(cafile=certifi.where())) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as ex:
        try: message=json.loads(ex.read())
        except (ValueError, UnicodeError): message={"error":"upstream unavailable"}
        return ex.code, message

class Adapter(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_POST(self):
        try:
            size=int(self.headers.get("Content-Length",0))
            if size<=0 or size>9000: raise ValueError("body")
            body=json.loads(self.rfile.read(size)); run=body["run"]
            with lock: job=jobs.get(run)
            if not job or not hmac.compare_digest(self.headers.get("Authorization",""),"Bearer "+job["ticket"]):
                status,value=403,{"error":"Invalid job"}
            elif self.path=="/step/classify":
                data=body["input"]
                message=SCENARIOS[data["scenario"]]["text"] if job["base"]==PUBLIC else data["message"]
                value={"analysis":classify_message(message[:2000])};status=200
            elif self.path in {"/step/"+s for s in ("load","approve","crm","duplicate","handover","interrupted")}:
                status,value=post(job["base"]+"/engine"+self.path,body,job["ticket"])
            else: status,value=404,{"error":"Unknown step"}
        except Exception as error:
            print("Adapter error:",type(error).__name__,flush=True)
            status,value=502,{"error":"Step unavailable"}
        raw=json.dumps(value).encode()
        self.send_response(status);self.send_header("Content-Type","application/json");self.send_header("Content-Length",str(len(raw)));self.end_headers();self.wfile.write(raw)

def execute(base,job):
    try:
        status,_=post(WEBHOOK,job,timeout=135)
        if status>=400: raise RuntimeError("Workflow failed")
    except Exception as error:
        print("Workflow error:",type(error).__name__,flush=True)
        try: post(base+"/engine/step/failure",{"run":job["run"]},job["ticket"])
        except Exception: pass
    finally:
        with lock: jobs.pop(job["run"],None)

def poll():
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        while True:
            try:
                with urllib.request.urlopen("http://127.0.0.1:17963/healthz/readiness", timeout=3) as health:
                    if health.status != 200: raise OSError("n8n not ready")
            except OSError:
                time.sleep(3)
                continue
            for base in BASES:
                try:
                    with lock: busy=len(jobs)
                    path="/engine/heartbeat" if busy>=2 else "/engine/lease"
                    status,data=post(base+path,{},KEY,timeout=7)
                    job=data.get("job") if status==200 else None
                    if job:
                        with lock: jobs[job["run"]]={**job,"base":base}
                        pool.submit(execute,base,job)
                except (OSError,ValueError): pass
            time.sleep(3)

if __name__=="__main__":
    httpd=ThreadingHTTPServer(("127.0.0.1",17962),Adapter)
    threading.Thread(target=poll,daemon=True).start()
    httpd.serve_forever()
