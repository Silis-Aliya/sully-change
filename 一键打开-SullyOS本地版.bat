@echo off
setlocal
cd /d "%~dp0"

title SullyOS local dev

echo [SullyOS] Working directory: %cd%

where node >nul 2>nul
if errorlevel 1 (
  echo [Error] Node.js not found. Please install Node.js first.
  pause
  exit /b 1
)

set "PNPM_CMD=C:\Users\huiji\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
if not exist "%PNPM_CMD%" (
  where pnpm >nul 2>nul
  if errorlevel 1 (
    echo [Error] pnpm not found.
    echo Expected pnpm at: %PNPM_CMD%
    pause
    exit /b 1
  )
  set "PNPM_CMD=pnpm"
)

echo [SullyOS] Using pnpm: %PNPM_CMD%

if not exist "node_modules" (
  echo [SullyOS] Installing dependencies. This only happens the first time...
  call "%PNPM_CMD%" install
  if errorlevel 1 (
    echo [Error] pnpm install failed.
    pause
    exit /b 1
  )
)

echo [SullyOS] Starting local dev server...
echo [SullyOS] Browser will open at http://localhost:5173
start "" "http://localhost:5173"
call "%PNPM_CMD%" run dev -- --host 127.0.0.1

pause
