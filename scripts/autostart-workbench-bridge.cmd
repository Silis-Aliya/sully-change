@echo off
setlocal

cd /d "%~dp0.."

if "%WORKBENCH_BRIDGE_PORT%"=="" set "WORKBENCH_BRIDGE_PORT=3001"
if "%WORKBENCH_AGENT%"=="" set "WORKBENCH_AGENT=codex"

pnpm workbench:bridge -- --host 0.0.0.0 --port %WORKBENCH_BRIDGE_PORT% --agent %WORKBENCH_AGENT% >> workbench-bridge.log 2>&1
