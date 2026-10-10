# Configure hourly updates using Windows Task Scheduler (logged-in user).
param(
 [string]$RepoPath = (Split-Path -Parent $PSScriptRoot),
 [string]$TaskName = "MSS-Sample-AutoUpdate",
 [string]$Pm2Names = "",
 [int]$IntervalMinutes = 60
)
$ErrorActionPreference = "Stop"
if ($IntervalMinutes -lt 15) { throw "Minimum update interval: 15 minutes." }
$RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path
$scriptPath = Join-Path $RepoPath "scripts\update-windows.ps1"
if (-not (Test-Path $scriptPath)) { throw "Updater script not found: $scriptPath" }
$arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $scriptPath + '"'
if ($Pm2Names.Trim()) {
    $safeNames = $Pm2Names.Replace('"','')
    $arguments += ' -Pm2Names "' + $safeNames + '"'
}
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $RepoPath
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Installed Windows scheduled task: $TaskName"
Write-Host "Frequency: every $IntervalMinutes minutes; user: $userId (only while logged in)"
Write-Warning "If -Pm2Names was omitted, code is downloaded and built but running services will not restart."
