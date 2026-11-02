# Records the Capture Kit from a clean state: separate data folder, separate server on port 3200.
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
for ($i = 0; $i -lt 60; $i++) { try { if ((Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8100/v1/health" -TimeoutSec 3).StatusCode -eq 200) { break } } catch { Start-Sleep 3 } }
$pidFile = ".data\capture\pid.txt"
if (Test-Path $pidFile) { Stop-Process -Id ([int](Get-Content $pidFile)) -Force -ErrorAction SilentlyContinue; Start-Sleep 2 }
Remove-Item capture-kit -Recurse -Force -ErrorAction SilentlyContinue
cmd /c "npx tsx scripts/capture-kit/setup.ts > .data\cap-setup.txt 2>&1"
inference\.venv\Scripts\python.exe scripts\capture-kit\scenes.py | Select-Object -First 1
New-Item -ItemType Directory -Force capture-kit\stills | Out-Null
$env:NODE_ENV = "production"; $env:PORT = "3200"; $env:DATA_DIR = "$root\.data\capture"; $env:INFERENCE_URL = "http://127.0.0.1:8100"; $env:SESSION_SECRET = "capture-only-secret-capture-only-secret"
$srv = Start-Process -PassThru -WindowStyle Hidden -FilePath node -ArgumentList "dist/server.cjs" -RedirectStandardOutput ".data\capture\app.log" -RedirectStandardError ".data\capture\app.err.log"
Set-Content $pidFile $srv.Id
Start-Sleep 6
Remove-Item env:PORT, env:DATA_DIR, env:NODE_ENV, env:SESSION_SECRET, env:INFERENCE_URL
$env:CAPTURE_FFMPEG = (inference\.venv\Scripts\python.exe -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
cmd /c "npx playwright test -c e2e-capture/playwright.config.ts > .data\capture\run.txt 2>&1"
Select-String -Path .data\capture\run.txt -Pattern '[0-9]+ (passed|failed)|Error:|Received|Locator:|capture\.spec\.ts:[0-9]+:[0-9]+$|Expected' | ForEach-Object { $_.Line.Substring(0, [Math]::Min(170, $_.Line.Length)) } | Select-Object -First 10
(Get-ChildItem .data\capture\raw\*.webm -ErrorAction SilentlyContinue | ForEach-Object { $_.BaseName }) -join ' '
