@echo off
setlocal
cd /d ..\Sakura-Auth-Server
start "sakura-idp" /min cmd /c "set PORT=9000 && set BASE_URL=http://localhost:9000 && node server.js > %TEMP%\idp.log 2>&1"
timeout /t 6 > nul
echo --- IDP heartbeat ---
curl -s http://127.0.0.1:9000/api/heartbeat
echo.
endlocal
