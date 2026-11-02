# Goes on after a failed recording: same data, same server, from the auditor onward.
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
$env:CAPTURE_RESUME = '1'
$env:CAPTURE_FFMPEG = (inference\.venv\Scripts\python.exe -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
cmd /c "npx playwright test -c e2e-capture/playwright.config.ts > .data\captureun.txt 2>&1"
Select-String -Path .data\captureun.txt -Pattern '[0-9]+ (passed|failed)|Error:|Received|Locator:|capture\.spec\.ts:[0-9]+:[0-9]+$' | ForEach-Object { $_.Line.Substring(0, [Math]::Min(170, $_.Line.Length)) } | Select-Object -First 8
(Get-ChildItem .data\captureinished).Count
