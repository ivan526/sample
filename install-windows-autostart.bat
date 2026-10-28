@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows-autostart.ps1" -RepoPath "%~dp0."
if errorlevel 1 goto failed
echo Windows autostart is installed. No login is needed after reboot.
pause
exit /b 0

:failed
echo Installation failed. Right-click this BAT and select Run as administrator.
echo Review the error above. Application logs are in data\logs.
pause
exit /b 1
