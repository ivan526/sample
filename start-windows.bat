@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-windows.ps1" -RepoPath "%~dp0."
if errorlevel 1 goto failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1" -RepoPath "%~dp0." -RequireFreePorts
if errorlevel 1 goto failed
exit /b 0

:failed
echo Service restart failed. Review the error above.
pause
exit /b 1
