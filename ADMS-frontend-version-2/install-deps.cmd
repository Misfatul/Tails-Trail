@echo off
setlocal
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
echo Installing Tails Trail dependencies...
echo.
"C:\Program Files\nodejs\npm.cmd" install
pause
