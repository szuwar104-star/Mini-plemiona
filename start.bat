@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Mini Plemiona - uruchamiam lokalny serwer...
where node >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  node serve.js 8080
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  py -m http.server 8080
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  python -m http.server 8080
  goto :eof
)
echo Nie znaleziono Node.js ani Pythona. Zainstaluj jedno z nich albo otworz index.html bezposrednio.
pause
