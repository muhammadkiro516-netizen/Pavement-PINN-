# Stops the processes started by scripts\v5-live.ps1. Only touches the ids it recorded.
$root = Split-Path -Parent $PSScriptRoot
$pids = "$root\.data\v5-live\pids.txt"
if (Test-Path $pids) {
  (Get-Content $pids) -split ' ' | ForEach-Object {
    if ($_) { Stop-Process -Id ([int]$_) -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item $pids
}
