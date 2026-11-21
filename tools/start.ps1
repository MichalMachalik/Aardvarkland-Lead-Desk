param([switch]$Initialize)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$state = Join-Path $env:LOCALAPPDATA 'Aardvarkland/LeadDesk'
New-Item -ItemType Directory -Force $state | Out-Null
$keyFile = Join-Path $state 'engine-key.xml'
if (!(Test-Path $keyFile)) {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $key = [Convert]::ToBase64String($bytes)
    ConvertTo-SecureString $key -AsPlainText -Force | Export-Clixml $keyFile
}
$secure = Import-Clixml $keyFile
$env:LEAD_ENGINE_KEY = [Net.NetworkCredential]::new('', $secure).Password
$env:LEAD_STATE_DIR = Join-Path $state 'private'
$env:N8N_USER_FOLDER = Join-Path $state 'n8n'
$env:N8N_LISTEN_ADDRESS = '127.0.0.1'
$env:N8N_HOST = '127.0.0.1'
$env:N8N_PORT = '17963'
$env:N8N_PROTOCOL = 'http'
$env:N8N_DIAGNOSTICS_ENABLED = 'false'
$env:N8N_VERSION_NOTIFICATIONS_ENABLED = 'false'
$env:N8N_TEMPLATES_ENABLED = 'false'
$env:N8N_DISABLE_UI = 'true'
$env:N8N_SECURE_COOKIE = 'false'
$env:EXECUTIONS_DATA_SAVE_ON_SUCCESS = 'none'
$env:EXECUTIONS_DATA_SAVE_ON_ERROR = 'none'
$env:N8N_LOG_LEVEL = 'warn'
$env:N8N_DEFAULT_LOCALE = 'en'
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$engine = Join-Path $state 'engine'
$cli = Join-Path $engine 'node_modules/n8n/bin/n8n'
if (!(Test-Path $cli)) {
    npm.cmd install --prefix $engine n8n@2.48.7 --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE) {throw 'n8n installation failed'}
}
$node = (Get-Command node).Source
$python = (Get-Command python).Source
$config = Join-Path $state 'model.json'
if (Test-Path $config) {
    $modelConfig = Get-Content $config -Raw | ConvertFrom-Json
    $env:LEAD_MODEL_FILE = $modelConfig.model
    $env:LEAD_MODEL_SERVER = $modelConfig.server
}
function Listening([int]$port) {
    $tcp = New-Object Net.Sockets.TcpClient
    try { $tcp.Connect('127.0.0.1',$port); return $true } catch { return $false } finally { $tcp.Dispose() }
}
function Background($name,$exe,$arguments) {
    Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $state "$name.out") -RedirectStandardError (Join-Path $state "$name.err") | Out-Null
}
if ($Initialize -or !(Test-Path (Join-Path $state 'installed-v1'))) {
    if (Listening 17963) {throw 'Stop this n8n instance before reimporting the workflow.'}
    & $node $cli 'import:workflow' ('--input='+(Join-Path $root 'workflow/lead-desk.json'))
    if ($LASTEXITCODE) {throw 'Workflow import failed'}
    & $node $cli 'publish:workflow' '--id=AardLeadDesk01'
    if ($LASTEXITCODE) {throw 'Workflow activation failed'}
    Set-Content (Join-Path $state 'installed-v1') '2.48.7'
}
if (!(Listening 17964)) {
    if (!(Test-Path $env:LEAD_MODEL_SERVER) -or !(Test-Path $env:LEAD_MODEL_FILE)) {throw 'Set the model and llama-server paths before starting.'}
    Background 'model' $env:LEAD_MODEL_SERVER @('-m',('"'+$env:LEAD_MODEL_FILE+'"'),'--port','17964','--host','127.0.0.1','-c','3072','-np','1','-t','4','-ngl','0','--sleep-idle-seconds','180','--no-warmup')
}
if (!(Listening 17963)) {Background 'n8n' $node @(('"'+$cli+'"'),'start')}
if (!(Listening 17965)) {Background 'private' $node @('server/local.mjs')}
if (!(Listening 17962)) {Background 'bridge' $python @('server/bridge.py')}
