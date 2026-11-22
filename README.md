# Aardvarkland Lead Desk

[Česká verze](#cesky)

[Public demo](https://michalmachalik.github.io/Aardvarkland-Lead-Desk/) · [n8n workflow](workflow/lead-desk.json) · [Recorded classifications](relay/recordings.json)

Lead Desk takes a sales enquiry from the first message to an approved reply. The opportunity and follow-up task share a stable identifier. The operator reviews the draft before it reaches the outbox.

## Try the workflow

1. Select **Poptávky z webu do CRM**, enable the simulated CRM outage and choose **Zpracovat poptávku**. The CRM saves the opportunity and then returns HTTP 503.
2. Restore the connection and retry. The workflow finds the same opportunity, creates the follow-up task and prepares a reply. Submitting again returns the same opportunity number.
3. Edit and approve the reply, then open **Schránka** to see the message. Try **Dotaz na cenu** to see how the workflow requests clarification.

| Mode | Processing | Data |
| --- | --- | --- |
| Cloud preview | GitHub Pages, a Cloudflare Worker and D1. Three predefined messages replay verified model output. CRM writes, retries, approval and the outbox run on the server. | Each browser profile has its own workspace. A daily cleanup removes fictional records after two days. |
| Live workflow in the demo | A local processor claims a one-time job over HTTPS. n8n calls the local model and runs the workflow. The history shows the actual execution number. This mode requires an available processor. | Uses the same fixed catalogue. Approved messages go to a test mailbox. |
| Private application | n8n, llama.cpp and a local HTTP service. Operators can supply their own message and contact and edit the draft. If n8n is unavailable, new requests are rejected and interrupted runs can be retried. | Starts with a separate, empty SQLite database on disk. The interface listens on loopback only. |

## Run locally on Windows

Install Node.js 24, npm, Python 3.11+ and llama-server with Qwen3-4B-Instruct-2507 in GGUF format. The published classifications used Q4_K_M quantization, temperature 0 and seed 42. The [classifier](server/classifier.py) defines the response schema.

```powershell
python -m pip install -r server/requirements.txt
$env:LEAD_MODEL_SERVER = 'D:\Models\llama-server.exe'
$env:LEAD_MODEL_FILE = 'D:\Models\Qwen3-4B-Instruct-2507-Q4_K_M.gguf'
$env:LEAD_PRIVATE_ONLY = '1'
.\tools\start.ps1
```

Open `http://127.0.0.1:17965/`. The launcher installs n8n 2.48.7, imports and activates the workflow and starts the services in the background. The model uses port 17964, n8n uses 17963 and the adapter uses 17962. Private records and configuration live under `%LOCALAPPDATA%\Aardvarkland\LeadDesk`. Windows DPAPI protects the processor key. You can inspect or import the workflow as JSON. Execution requires the adapter described above.

By default, the private outbox stores approved replies locally. To enable delivery through Resend, set `RESEND_API_KEY` and a verified sender in `LEAD_FROM` before starting the local service. Retries reuse the same delivery key. If delivery is still uncertain after 23 hours, check the provider's record before retrying.

## Deploy the public preview

GitHub Pages serves `docs/`. The Worker uses a D1 binding and the [database schema](relay/schema.sql). For your own deployment, create the database, set its ID in the configuration, configure the Worker domain in both the client and the adapter, and set the allowed Pages origin in the Worker. Deploy with Wrangler and set the `ENGINE_KEY` secret to match the processor key. The cloud preview runs independently. To attach your own processor, turn off `LEAD_PRIVATE_ONLY`. Keep the n8n editor private.

## Verification

```powershell
python tests/journey.py https://aardvarkland-lead-desk.dso-activation.workers.dev cloud
python tests/journey.py https://aardvarkland-lead-desk.dso-activation.workers.dev n8n
npm install --no-save playwright
npx playwright install chromium firefox
node tests/browser.cjs
```

The HTTP test covers failure after a successful write, retries, concurrent submissions, duplicate approval and workspace isolation. The browser test covers all three cases, navigation, the outbox after a page reload and the mobile layout.

---

<a name="cesky"></a>

## Česká verze

[Veřejné demo](https://michalmachalik.github.io/Aardvarkland-Lead-Desk/) · [Workflow pro n8n](workflow/lead-desk.json) · [Záznam klasifikace](relay/recordings.json)

Zpracování poptávky od první zprávy po schválení odpovědi. Příležitost a obchodní úkol sdílejí stabilní identifikátor. Zpráva vznikne až po schválení obsluhou.

### Vyzkoušení

1. U poptávky **Poptávky z webu do CRM** zaškrtněte výpadek CRM a zvolte **Zpracovat poptávku**. CRM zápis provede, ale vrátí stav 503.
2. Obnovte spojení. Průchod dohledá tutéž příležitost, založí úkol a připraví odpověď. Další odeslání ukáže stejné číslo příležitosti.
3. Upravte znění, schvalte odpověď a otevřete **Schránku**. U případu **Dotaz na cenu** systém požádá o upřesnění.

| Režim | Zpracování | Data |
| --- | --- | --- |
| Cloudové preview | GitHub Pages, Cloudflare Worker a D1. Pro tři pevné zprávy přehrává ověřený výstup modelu. Zápis CRM, opakování, schválení a schránka běží na serveru. | Oddělený prostor pro každý profil prohlížeče. Fiktivní záznamy se po dvou dnech při denním úklidu odstraní. |
| Živý průchod v demu | Místní zpracovatel vyzvedne jednorázovou úlohu přes HTTPS. n8n zavolá místní model a provede kroky workflow. Historie obsahuje číslo skutečné exekuce. Vyžaduje dostupný zpracovatel. | Stejný uzavřený katalog. Schválená zpráva končí v testovací schránce. |
| Soukromá aplikace | n8n, llama.cpp a místní HTTP služba. Vlastní text, kontakt a upravitelný návrh odpovědi. Při výpadku n8n se nový požadavek odmítne, přerušený průchod lze zopakovat. | Samostatná prázdná databáze SQLite na disku. Rozhraní je přístupné pouze na loopbacku. |

### Místní spuštění na Windows

Vyžaduje Node.js 24, npm, Python 3.11+ a llama-server s modelem Qwen3-4B-Instruct-2507 ve formátu GGUF. Publikované klasifikace vznikly s kvantizací Q4_K_M, teplotou 0 a seedem 42. Schéma odpovědi určuje [klasifikátor](server/classifier.py).

```powershell
python -m pip install -r server/requirements.txt
$env:LEAD_MODEL_SERVER = 'D:\Models\llama-server.exe'
$env:LEAD_MODEL_FILE = 'D:\Models\Qwen3-4B-Instruct-2507-Q4_K_M.gguf'
$env:LEAD_PRIVATE_ONLY = '1'
.\tools\start.ps1
```

Otevřete `http://127.0.0.1:17965/`. Spouštěč nainstaluje n8n 2.48.7, importuje a aktivuje workflow a spustí služby na pozadí. Model používá port 17964, n8n 17963 a adaptér 17962. Soukromé záznamy a konfigurace se ukládají pod `%LOCALAPPDATA%\Aardvarkland\LeadDesk`. Klíč zpracovatele je chráněn Windows DPAPI. Workflow lze prohlížet i importovat jako JSON. Pro jeho spuštění musí být dostupný uvedený adaptér.

Soukromá schránka standardně ukládá schválené odpovědi lokálně. Volitelný transport Resend se zapne nastavením `RESEND_API_KEY` a ověřeného odesílatele `LEAD_FROM` před spuštěním místní služby. Odeslání používá stabilní klíč. Po nejednoznačném výsledku starším než 23 hodin vyžaduje další odeslání ruční kontrolu u poskytovatele.

### Nasazení veřejné části

GitHub Pages publikuje adresář `docs/`. Worker s vazbou D1 používá [schéma](relay/schema.sql). Pro vlastní nasazení založte databázi, nastavte její ID v konfiguraci, doménu Workeru v klientu a adaptéru a povolený původ stránek ve Workeru. Nasaďte Worker přes Wrangler a nastavte secret `ENGINE_KEY` shodný s klíčem zpracovatele. Cloudové preview funguje samostatně. Při zapojení vlastního zpracovatele vypněte `LEAD_PRIVATE_ONLY`. Editor n8n se veřejně nevystavuje.

### Ověření

```powershell
python tests/journey.py https://aardvarkland-lead-desk.dso-activation.workers.dev cloud
python tests/journey.py https://aardvarkland-lead-desk.dso-activation.workers.dev n8n
npm install --no-save playwright
npx playwright install chromium firefox
node tests/browser.cjs
```

HTTP test pokrývá výpadek po zápisu, opakování, souběžné odeslání, dvě schválení a oddělení pracovních prostorů. Browserový test prochází všechny tři případy, navigaci, schránku po obnovení stránky a mobilní zobrazení.
