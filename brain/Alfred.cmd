@echo off
setlocal
cd /d "%~dp0"

if "%PORT%"=="" set PORT=7777

echo Starting ALFRED server on port %PORT%...
start "ALFRED Server" /min cmd /c "node server.mjs"

timeout /t 1 /nobreak >nul

start "" "http://localhost:%PORT%"

endlocal
