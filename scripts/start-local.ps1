# Start PavementPINN on this laptop and keep it running (Windows PowerShell).
# Public address: Tailscale Funnel (https://<device>.<tailnet>.ts.net -> http://127.0.0.1:3100),
# which runs as the Tailscale Windows service and survives restarts on its own.
#   powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1
# Every 30 s the watchdog restarts the AI service (8100) or the app (3100) if one of them stopped.
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force -Path (Join-Path $root '.data') | Out-Null

function Test-Up([string]$url) {
  try { (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $false }
}

function Start-Inference {
  Start-Process -FilePath (Join-Path $root 'inference\.venv\Scripts\python.exe') `
    -ArgumentList '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8100' `
    -WorkingDirectory (Join-Path $root 'inference') -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root '.data\inference.log') -RedirectStandardError (Join-Path $root '.data\inference.err.log')
}

function Start-App {
  $env:NODE_ENV = 'production'; $env:PORT = '3100'; $env:VITE_BASE_PATH = '/'
  Start-Process -FilePath 'node' -ArgumentList 'dist/server.cjs' -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root '.data\server-3100.log') -RedirectStandardError (Join-Path $root '.data\server-3100.err.log')
}

while ($true) {
  if (-not (Test-Up 'http://127.0.0.1:8100/v1/cv/health')) {
    Add-Content (Join-Path $root '.data\watchdog.log') "$(Get-Date -Format s) start inference"
    Start-Inference
    Start-Sleep -Seconds 40
  }
  if (-not (Test-Up 'http://127.0.0.1:3100/')) {
    Add-Content (Join-Path $root '.data\watchdog.log') "$(Get-Date -Format s) start app"
    Start-App
    Start-Sleep -Seconds 8
  }
  Start-Sleep -Seconds 30
}
