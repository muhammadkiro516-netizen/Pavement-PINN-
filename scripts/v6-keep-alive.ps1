# Keeps the public link working while the app runs. Windows does not sleep while this script is alive
# (no power setting is changed; closing a laptop lid can still force sleep), and a tunnel that died gets
# replaced. A new tunnel means a new address: the current one is always in .data\v6-url.txt.
#
#   powershell -ExecutionPolicy Bypass -File scripts\v6-keep-alive.ps1
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$data = "$root\.data\v5-live"
$urlFile = "$root\.data\v6-url.txt"

Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]1

function Test-Link {
  $url = if (Test-Path $urlFile) { (Get-Content $urlFile -Raw).Trim() } else { $null }
  if (-not $url) { return $false }
  try { return (Invoke-WebRequest -UseBasicParsing "$url/api/v5/public/cases" -TimeoutSec 20).StatusCode -eq 200 } catch { return $false }
}

function Start-Tunnel {
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  Remove-Item "$data\tunnel.log" -ErrorAction SilentlyContinue
  $line = "`"$root\.data\cloudflared.exe`" tunnel --no-autoupdate --logfile `"$data\tunnel.log`" --url http://localhost:3100"
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $line; CurrentDirectory = $root } | Out-Null
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $hit = Select-String -Path "$data\tunnel.log" -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Where-Object { $_.Line -notmatch 'api\.' } | Select-Object -First 1
    if ($hit) { Set-Content $urlFile $hit.Matches[0].Value; return }
  }
}

$failures = 0
while ($true) {
  [Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED) | Out-Null
  if (Test-Link) { $failures = 0 } else { $failures += 1 }
  if ($failures -ge 3) { Start-Tunnel; $failures = 0; Start-Sleep -Seconds 25 }
  Start-Sleep -Seconds 30
}
