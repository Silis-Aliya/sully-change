@echo off
setlocal

set "CLOUDFLARED=C:\Program Files (x86)\cloudflared\cloudflared.exe"
set "CONFIG=%USERPROFILE%\.cloudflared\config.yml"

"%CLOUDFLARED%" tunnel --config "%CONFIG%" run >> "%~dp0..\cloudflared-code.log" 2>&1
