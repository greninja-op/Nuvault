@echo off
REM Run this after you change the app. It rebuilds the React client and
REM restarts the Nuvault server so http://localhost:5001 shows the latest
REM version. Double-click it, or run `update-nuvault` from a terminal here.
echo Building Nuvault client...
cd /d "%~dp0client"
call npm run build
if errorlevel 1 (
  echo.
  echo BUILD FAILED - server not restarted. Fix the errors above and retry.
  pause
  exit /b 1
)
echo Restarting Nuvault server...
cd /d "%~dp0"
call pm2 restart nuvault
call pm2 save
echo.
echo Done. Open http://localhost:5001
pause
