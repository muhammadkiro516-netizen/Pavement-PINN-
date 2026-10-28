# PAVEMENT-PINN: run the real app and give it a free public HTTPS link.
#
#   powershell -ExecutionPolicy Bypass -File scripts\go-live.ps1
#
# 1. builds the web app and the server (npm run build);
# 2. starts the AI service (FastAPI + OpenVINO, port 8100) from inference\.venv;
# 3. starts the app server in production mode (port 3000, base path /);
# 4. downloads cloudflared once (free, no account) and opens a quick tunnel; the
#    https://<random>.trycloudflare.com link it prints is the public address.
# Ctrl+C stops the tunnel; the two servers are stopped with it.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path "inference\.venv\Scripts\python.exe")) {
  Write-Host "Setting up the AI runtime (one time)..."
  python -m venv inference\.venv
  & inference\.venv\Scripts\python.exe -m pip install -q -r inference\requirements.txt openvino opencv-python-headless nncf
}

$env:VITE_BASE_PATH = "/"
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

$ai = Start-Process -PassThru -WindowStyle Hidden -WorkingDirectory "$root\inference" `
  -FilePath "$root\inference\.venv\Scripts\python.exe" -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8100"

$env:NODE_ENV = "production"
$env:PORT = "3000"
$app = Start-Process -PassThru -WindowStyle Hidden -WorkingDirectory $root -FilePath "node" -ArgumentList "dist/server.cjs"

$cf = "$root\.data\cloudflared.exe"
if (-not (Test-Path $cf)) {
  New-Item -ItemType Directory -Force "$root\.data" | Out-Null
  Write-Host "Downloading cloudflared (one time)..."
  Invoke-WebRequest "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cf
}

if (-not (Test-Path "$root\.data\accounts.json")) {
  Write-Host ""
  Write-Host "No accounts yet. Create the first Koordinator in another terminal:"
  Write-Host '  $env:PINN_PASSWORD="kata-sandi-anda"; npm run create-coordinator -- email@instansi.go.id "Nama" "Nama Instansi"'
}

Write-Host ""
Write-Host "Local:  http://localhost:3000/"
Write-Host "Public: the https://...trycloudflare.com link below"
try {
  & $cf tunnel --url http://localhost:3000
} finally {
  Stop-Process -Id $app.Id -ErrorAction SilentlyContinue
  Stop-Process -Id $ai.Id -ErrorAction SilentlyContinue
}
