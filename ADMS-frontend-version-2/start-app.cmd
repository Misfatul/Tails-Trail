@echo off
setlocal
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
netstat -ano | findstr :8080 >nul
if %errorlevel%==0 (
  echo Tails Trail is already running on http://localhost:8080
  start "" "http://localhost:8080"
  exit /b 0
)

call "%~dp0start-db.cmd"
if errorlevel 1 (
  echo Failed to start local MySQL.
  pause
  exit /b 1
)

echo Starting Tails Trail on http://localhost:8080
echo.
del "%~dp0server.out.log" "%~dp0server.err.log" >nul 2>nul
start "Tails Trail Server" cmd /k ""C:\Program Files\nodejs\node.exe" "%~dp0server.js" 1>"%~dp0server.out.log" 2>"%~dp0server.err.log""
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0; $i -lt 30; $i++){ try { Invoke-RestMethod 'http://localhost:8080/api/health' | Out-Null; $ok=$true; break } catch { Start-Sleep -Seconds 1 } }; if(-not $ok){ exit 1 }"
if errorlevel 1 (
  echo Tails Trail server did not become ready in time.
  echo.
  echo Server output:
  type "%~dp0server.out.log"
  echo.
  echo Server errors:
  type "%~dp0server.err.log"
  pause
  exit /b 1
)
start "" "http://localhost:8080"
echo Tails Trail is ready at http://localhost:8080
