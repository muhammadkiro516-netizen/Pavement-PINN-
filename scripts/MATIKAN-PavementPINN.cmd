@echo off
rem Matikan PavementPINN (penjaga, server, AI). Tailscale tetap terpasang.
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*start-local.ps1*' -or $_.CommandLine -like '*dist/server.cjs*' -or $_.CommandLine -like '*uvicorn app.main:app*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo PavementPINN dimatikan.
timeout /t 5 >nul
