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
  echo [%date% %time%] Refusing to autostart without WORKBENCH_BRIDGE_TOKEN. Set the environment variable or save it in %USERPROFILE%\.sullyos-workbench-bridge-token. >> workbench-bridge.log
  exit /b 1
)

pnpm workbench:bridge -- --host 0.0.0.0 --port %WORKBENCH_BRIDGE_PORT% --agent %WORKBENCH_AGENT% --token "%WORKBENCH_BRIDGE_TOKEN%" >> workbench-bridge.log 2>&1
