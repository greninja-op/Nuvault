@echo off
REM Nuvault auto-start. A copy of this file is placed in the Windows
REM Startup folder so pm2 restores the Nuvault server on every login,
REM even after a reboot. It restarts the saved pm2 process list.
cd /d "%~dp0"
call pm2 resurrect
exit
