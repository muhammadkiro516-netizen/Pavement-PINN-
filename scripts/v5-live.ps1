# PAVEMENT-PINN v5 demo: build, run in DEMO MODE on its own data folder, open a public HTTPS link.
#
#   powershell -ExecutionPolicy Bypass -File scripts\v5-live.ps1
#
# DATA_DIR is .data\v5-demo so the tunnel never serves the pilot data in .data\.
# The link is printed into .data\v5-demo\tunnel.log. Stop with scripts\v5-stop.ps1.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$port = 3100
$data = "$root\.data\v5-demo"
New-Item -ItemType Directory -Force $data | Out-Null

& "$PSScriptRoot\v5-stop.ps1"

$env:VITE_BASE_PATH = "/"
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

$ai = Start-Process -PassThru -WindowStyle Hidden -WorkingDirectory "$root\inference" `
  -FilePath "$root\inference\.venv\Scripts\python.exe" -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8100" `
  -RedirectStandardOutput "$data\inference.log" -RedirectStandardError "$data\inference.err.log"

$env:NODE_ENV = "production"
$env:PORT = "$port"
$env:DATA_DIR = $data
$env:DEMO_MODE = "1"
$env:INFERENCE_URL = "http://127.0.0.1:8100"
if (-not $env:SESSION_SECRET) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $env:SESSION_SECRET = [Convert]::ToBase64String($bytes)
}
$app = Start-Process -PassThru -WindowStyle Hidden -WorkingDirectory $root -FilePath "node" -ArgumentList "dist/server.cjs" `
  -RedirectStandardOutput "$data\app.log" -RedirectStandardError "$data\app.err.log"

$cf = "$root\.data\cloudflared.exe"
if (-not (Test-Path $cf)) {
  Write-Host "Downloading cloudflared (one time)..."
  Invoke-WebRequest "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cf
}
$log = "$data\tunnel.log"
if (Test-Path $log) { Remove-Item $log }
$tunnel = Start-Process -PassThru -WindowStyle Hidden -FilePath $cf -ArgumentList "tunnel", "--no-autoupdate", "--url", "http://localhost:$port" -RedirectStandardError $log -RedirectStandardOutput "$data\tunnel.out.log"

"$($ai.Id) $($app.Id) $($tunnel.Id)" | Set-Content "$data\pids.txt"

$url = $null
for ($i = 0; $i -lt 40 -and -not $url; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path $log) {
    $found = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($found) { $url = $found.Matches[0].Value }
  }
}
if (-not $url) { throw "tunnel did not report a URL; see $log" }
Write-Host "Local:  http://localhost:$port/v5/"
Write-Host "Public: $url/v5/"
