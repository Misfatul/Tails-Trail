@echo off
setlocal
cd /d "%~dp0"

netstat -ano | findstr :3307 >nul
if %errorlevel%==0 (
  echo Local MySQL is already running on port 3307.
  goto wait_for_db
)

echo Starting local MySQL for Tails Trail on port 3307...
start "Tails Trail MySQL" "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe" --basedir="C:\Program Files\MySQL\MySQL Server 8.0" --datadir="%~dp0local-mysql-data" --port=3307 --mysqlx=0 --log-error="%~dp0local-mysql-run\local-mysql.err"

:wait_for_db
set ATTEMPTS=0
:db_loop
set /a ATTEMPTS+=1
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" --protocol=tcp -h 127.0.0.1 -P 3307 -u tails_trail_app -ptailstrail123! -D tailstrail_dbms -e "SELECT 1" >nul 2>nul
if %errorlevel%==0 (
  echo Local MySQL is ready.
  exit /b 0
)
if %ATTEMPTS% GEQ 30 (
  echo Local MySQL did not become ready in time.
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto db_loop
