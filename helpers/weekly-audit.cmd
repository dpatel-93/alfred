@echo off
REM weekly-audit.cmd — Headless weekly self-improve audit (Layer B).
REM Runs /self-improve in report-only mode and writes a timestamped report to
REM ~/.claude/audit-reports/. config-doctor surfaces new reports at session start.
REM Scheduled via Windows Task Scheduler (see setup summary). Safe: report-only,
REM never applies changes unattended.

setlocal
set "REPORTS=%USERPROFILE%\.claude\audit-reports"
if not exist "%REPORTS%" mkdir "%REPORTS%"

for /f "tokens=1-3 delims=/- " %%a in ("%date%") do set "STAMP=%%c-%%a-%%b"
set "OUT=%REPORTS%\audit-%STAMP%.md"

echo # Self-Improve Audit %STAMP% > "%OUT%"
echo. >> "%OUT%"
claude -p "/self-improve — report only, do NOT apply any changes. Summarize findings concisely." >> "%OUT%" 2>&1

REM Record the audit timestamp for config-doctor's 'audit due' check.
node -e "const fs=require('fs'),p=process.env.USERPROFILE+'/.claude/.config-doctor-state.json';let s={};try{s=JSON.parse(fs.readFileSync(p,'utf8'))}catch{};s.lastAudit=new Date().toISOString();fs.writeFileSync(p,JSON.stringify(s,null,2))"
endlocal
