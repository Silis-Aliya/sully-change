@echo off
setlocal

cd /d "%~dp0.."

if "%WORKBENCH_BRIDGE_PORT%"=="" set "WORKBENCH_BRIDGE_PORT=3001"
if "%WORKBENCH_AGENT%"=="" set "WORKBENCH_AGENT=codex"

echo Starting SullyOS Code Workbench CLI Bridge...
echo.
echo Agent: %WORKBENCH_AGENT%
echo Port:  %WORKBENCH_BRIDGE_PORT%
echo CWD:   %CD%
echo.
echo In SullyOS Code settings, use:
echo   http://YOUR-PC-IP:%WORKBENCH_BRIDGE_PORT%
echo.

node scripts\workbench-cli-bridge.mjs --host 0.0.0.0 --port %WORKBENCH_BRIDGE_PORT% --agent %WORKBENCH_AGENT%

pause
