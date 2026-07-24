@echo off
setlocal

cd /d "%~dp0.."

if "%WORKBENCH_BRIDGE_PORT%"=="" set "WORKBENCH_BRIDGE_PORT=3001"
if "%WORKBENCH_AGENT%"=="" set "WORKBENCH_AGENT=codex"
if "%WORKBENCH_BRIDGE_TOKEN%"=="" if exist "%USERPROFILE%\.sullyos-workbench-bridge-token" (
  set /p WORKBENCH_BRIDGE_TOKEN=<"%USERPROFILE%\.sullyos-workbench-bridge-token"
)
if "%WORKBENCH_BRIDGE_TOKEN%"=="" if exist ".workbench-bridge-token" (
  set /p WORKBENCH_BRIDGE_TOKEN=<".workbench-bridge-token"
)
if "%WORKBENCH_BRIDGE_TOKEN%"=="" (
  set /p WORKBENCH_BRIDGE_TOKEN=Enter Workbench bridge token:
)
if "%WORKBENCH_BRIDGE_TOKEN%"=="" (
  echo.
  echo Refusing to start without WORKBENCH_BRIDGE_TOKEN.
  echo Set WORKBENCH_BRIDGE_TOKEN or save it in %USERPROFILE%\.sullyos-workbench-bridge-token.
  echo Use localhost-only debugging with: node scripts\workbench-cli-bridge.mjs --host 127.0.0.1
  exit /b 1
)

echo Starting SullyOS Code Workbench CLI Bridge...
echo.
echo Agent: %WORKBENCH_AGENT%
echo Port:  %WORKBENCH_BRIDGE_PORT%
echo CWD:   %CD%
echo Auth:  Bearer token enabled
echo.
echo In SullyOS Code settings, use:
echo   http://YOUR-PC-IP:%WORKBENCH_BRIDGE_PORT%
echo.

node scripts\workbench-cli-bridge.mjs --host 0.0.0.0 --port %WORKBENCH_BRIDGE_PORT% --agent %WORKBENCH_AGENT% --token "%WORKBENCH_BRIDGE_TOKEN%"

pause
