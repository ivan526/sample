@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-windows.ps1" -RepoPath "%~dp0."
if errorlevel 1 goto failed
echo Frontend and backend services stopped.
echo Windows autostart remains installed for the next PC reboot.
pause
exit /b 0

:failed
echo Service shutdown failed. Review the error above.
echo If autostart is installed, right-click this BAT and select Run as administrator.
pause
exit /b 1
