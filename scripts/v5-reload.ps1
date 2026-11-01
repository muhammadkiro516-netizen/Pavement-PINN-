# Rebuilds and restarts only the app server. The tunnel and the AI service keep running, so the
# public URL stays the same while work continues. Start them first with scripts\v5-live.ps1.
#
#   powershell -ExecutionPolicy Bypass -File scripts\v5-reload.ps1
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$data = "$root\.data\v5-live"
$port = 3100

$env:VITE_BASE_PATH = "/"
cmd /c "npm run build > `"$data\build.log`" 2>&1"
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed. The running app was left as it is. See $data\build.log"; exit 1 }

$pidList = (Get-Content "$data\pids.txt") -split ' '
Stop-Process -Id ([int]$pidList[1]) -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$env:NODE_ENV = "production"
$env:PORT = "$port"
$env:DATA_DIR = $data
$env:INFERENCE_URL = "http://127.0.0.1:8100"
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$env:SESSION_SECRET = [Convert]::ToBase64String($bytes)
$app = Start-Process -PassThru -WindowStyle Hidden -WorkingDirectory $root -FilePath "node" -ArgumentList "dist/server.cjs" `
  -RedirectStandardOutput "$data\app.log" -RedirectStandardError "$data\app.err.log"
"$($pidList[0]) $($app.Id) $($pidList[2])" | Set-Content "$data\pids.txt"
Write-Host "Reloaded. App process $($app.Id)."
