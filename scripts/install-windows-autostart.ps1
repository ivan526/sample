# One-time installation: boot-triggered services, independent of interactive login.
param([string]$RepoPath = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'windows-autostart.ps1')
Assert-MssAdministrator
$RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path.TrimEnd('\','/')
if ($RepoPath.StartsWith('\\')) { throw 'Use a local disk folder, not a network share.' }
foreach ($file in @('package.json', '.env', 'server/src/index.ts', 'node_modules/tsx/dist/cli.mjs', 'node_modules/vite/bin/vite.js', 'scripts/run-windows-service.ps1')) {
  if (-not (Test-Path -LiteralPath (Join-Path $RepoPath $file))) { throw "Missing $file. Complete the normal installation/update first." }
}
$node = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$runner = Join-Path $RepoPath 'scripts\run-windows-service.ps1'
$names = Get-MssAutoStartTaskNames $RepoPath
# Validate ownership of every existing task before stopping or replacing anything.
foreach ($service in @('api', 'web')) {
  if (Get-ScheduledTask -TaskPath '\' -TaskName $names[$service] -ErrorAction SilentlyContinue) {
    Get-MssServiceTask $RepoPath $names[$service] $service | Out-Null
  }
}
foreach ($service in @('api', 'web')) {
  if (Get-ScheduledTask -TaskPath '\' -TaskName $names[$service] -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskPath '\' -TaskName $names[$service]
  }
}
& (Join-Path $RepoPath 'scripts/stop-windows.ps1') -RepoPath $RepoPath
if (-not $?) { throw 'Could not stop the old application. No tasks were replaced.' }

$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'
foreach ($service in @('api', 'web')) {
  $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $runner + '" -Service ' + $service + ' -RepoPath "' + $RepoPath + '" -Background -NodeExecutable "' + $node + '"'
  $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $RepoPath
  Register-ScheduledTask -TaskPath '\' -TaskName $names[$service] -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "MSS $service at boot; managed by $RepoPath" -Force | Out-Null
}
$data = Join-Path $RepoPath 'data'
New-Item -ItemType Directory -Path $data -Force | Out-Null
@{ version = 1; repoPath = $RepoPath; apiTask = $names.api; webTask = $names.web; nodeExecutable = $node } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $data 'windows-autostart.json') -Encoding UTF8

# Keep the existing per-user update task (including its proxy credentials).
# It needs elevation to stop/start SYSTEM-owned application tasks after installation.
$updatePath = Join-Path $RepoPath 'scripts\update-windows.ps1'
foreach ($task in @(Get-ScheduledTask | Where-Object {
  $_.Principal.LogonType -eq 'Interactive' -and
  @($_.Actions | Where-Object { $_.Arguments -and $_.Arguments.Contains('-File "' + $updatePath + '"') }).Count -gt 0
})) {
  $updatePrincipal = New-ScheduledTaskPrincipal -UserId $task.Principal.UserId -LogonType Interactive -RunLevel Highest
  Set-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Principal $updatePrincipal | Out-Null
}
& (Join-Path $RepoPath 'scripts/start-windows.ps1') -RepoPath $RepoPath -KeepRunning -WaitForReady
if (-not $?) { throw 'Tasks installed, but service readiness failed. Check data/logs and Task Scheduler.' }
Write-Host 'Windows autostart installed and services are ready.'
Write-Host 'After a reboot: starts without login, no GitHub download required.'
Write-Host "Tasks: $($names.api), $($names.web). Logs: data\logs."
Write-Host 'Continue using your existing update BAT as administrator.'
