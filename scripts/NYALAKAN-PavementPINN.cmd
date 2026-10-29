@echo off
rem Nyalakan PavementPINN (AI + server + penjaga otomatis). Alamat: https://avlfelo.tail8b73d2.ts.net
cd /d "%~dp0.."
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-local.ps1"
echo PavementPINN dinyalakan. Tunggu 1 menit lalu buka https://avlfelo.tail8b73d2.ts.net
timeout /t 8 >nul
