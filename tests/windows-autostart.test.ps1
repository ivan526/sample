# Real Windows Task Scheduler integration, isolated local HTTP services and task names.
# No production app, database, proxy, GitHub downloads or PC reboot is used.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $repo 'scripts/windows-autostart.ps1')
Assert-MssAdministrator
$work = Join-Path ([IO.Path]::GetTempPath()) ('mss autostart test ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$names = Get-MssAutoStartTaskNames $work
$updateTaskName = 'MSS-Test-Update-' + [guid]::NewGuid().ToString('N')
function Assert-True($Value, $Message) { if (-not $Value) { throw "FAIL: $Message" } }
function Write-File($Name, $Value) {
  $path = Join-Path $work $Name
  New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
  Set-Content -LiteralPath $path -Value $Value -Encoding UTF8
}
function Free-Port {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}
function Read-Service($Port) { return (Invoke-WebRequest "http://127.0.0.1:$Port/api/v1/healthz" -UseBasicParsing -TimeoutSec 2).Content | ConvertFrom-Json }
try {
  $apiPort = Free-Port
  do { $webPort = Free-Port } while ($webPort -eq $apiPort)
  foreach ($script in @('windows-autostart.ps1','install-windows-autostart.ps1','start-windows.ps1','stop-windows.ps1','run-windows-service.ps1','install-auto-update-task.ps1')) {
    Write-File "scripts/$script" (Get-Content -LiteralPath (Join-Path $repo "scripts/$script") -Raw)
  }
  Write-File 'package.json' '{"type":"commonjs"}'
  Write-File 'deployment-id.txt' (Split-Path -Leaf $work)
  Write-File '.env' "MSS_API_PORT=$apiPort`nVITE_DEV_PORT=$webPort"
  Write-File 'node_modules/tsx/dist/cli.mjs' "import {createRequire} from 'node:module'; createRequire(import.meta.url)(process.argv[2]);"
  $serverTemplate = @'
const http = require('node:http');
console.error('Test stderr warning must not terminate startup');
http.createServer((req,res) => {
 res.setHeader('content-type','application/json');
 res.end(JSON.stringify({pid:process.pid,user:process.env.USERNAME,cwd:process.cwd(),marker:require('node:fs').readFileSync('deployment-id.txt','utf8').replace(/^\uFEFF/,'').trim()}));
}).listen(PORT, '127.0.0.1');
'@
  Write-File 'server/src/index.ts' ($serverTemplate.Replace('PORT', "$apiPort"))
  Write-File 'node_modules/vite/bin/vite.js' ($serverTemplate.Replace('PORT', "$webPort"))
  Write-File 'scripts/update-windows.ps1' 'exit 0'
  $updateUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $updateArguments = '-NoProfile -File "' + (Join-Path $work 'scripts\update-windows.ps1') + '"'
  $updateAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $updateArguments -WorkingDirectory $work
  $updatePrincipal = New-ScheduledTaskPrincipal -UserId $updateUser -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $updateTaskName -Action $updateAction -Principal $updatePrincipal -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date).AddDays(30)) -Force | Out-Null

  & (Join-Path $work 'scripts/install-windows-autostart.ps1') -RepoPath $work
  $config = Get-MssAutoStartConfig $work
  $updateTask = Get-ScheduledTask -TaskName $updateTaskName
  Assert-True ($updateTask.Principal.UserId -eq $updateUser -and $updateTask.Principal.LogonType -eq 'Interactive' -and $updateTask.Principal.RunLevel -eq 'Highest') 'Existing updater keeps its account and gains the elevation required for SYSTEM services'
  Assert-True ($updateTask.Actions[0].Arguments -eq $updateArguments) 'Existing update action remains intact'
  Assert-True ($config.apiTask -eq $names.api -and $config.webTask -eq $names.web) 'Configuration persists stable, directory-specific names'
  foreach ($service in @('api','web')) {
    $task = Get-MssServiceTask $work $names[$service] $service
    Assert-True ($task.Principal.UserId -in @('SYSTEM','S-1-5-18')) 'Runs under SYSTEM, independent of login'
    Assert-True ($task.Principal.LogonType -eq 'ServiceAccount') 'No saved user password or interactive logon'
    Assert-True (@($task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' }).Count -eq 1) 'Boot trigger registered'
    Assert-True ($task.Settings.ExecutionTimeLimit -eq 'PT0S') 'No default 3-day task termination'
    Assert-True ($task.Settings.RestartCount -eq 999 -and $task.Settings.RestartInterval -eq 'PT1M') 'Crash recovery configured'
    Assert-True (-not $task.Settings.DisallowStartIfOnBatteries -and -not $task.Settings.StopIfGoingOnBatteries) 'Battery power does not prevent service'
  }
  $first = Read-Service $apiPort
  $owner = Invoke-CimMethod -InputObject (Get-CimInstance Win32_Process -Filter "ProcessId = $($first.pid)") -MethodName GetOwnerSid
  Assert-True ($owner.Sid -eq 'S-1-5-18' -and $first.marker -eq (Split-Path -Leaf $work)) "Actual background service has correct account and working directory: $($first | ConvertTo-Json -Compress)"
  & (Join-Path $work 'scripts/start-windows.ps1') -RepoPath $work -KeepRunning
  Assert-True ((Read-Service $apiPort).pid -eq $first.pid) 'Current-version checks keep running services intact'

  # Kill a real child to exercise background supervision and recovery (not a mock).
  Stop-Process -Id $first.pid -Force
  $deadline = (Get-Date).AddSeconds(100)
  $recovered = $null
  do {
    Start-Sleep -Seconds 1
    try { $recovered = Read-Service $apiPort } catch { $recovered = $null }
  } while ((-not $recovered -or $recovered.pid -eq $first.pid) -and (Get-Date) -lt $deadline)
  Assert-True ($recovered -and $recovered.pid -ne $first.pid) 'Exited server automatically restarts without a user/login'

  & (Join-Path $work 'scripts/stop-windows.ps1') -RepoPath $work
  foreach ($service in @('api','web')) { Assert-True ((Get-ScheduledTask -TaskName $names[$service]).State -ne 'Running') 'Update shutdown stops the supervisor first' }
  & (Join-Path $work 'scripts/start-windows.ps1') -RepoPath $work -RequireFreePorts -WaitForReady
  Assert-True ((Read-Service $apiPort).pid -ne $recovered.pid) 'Updater startup restarts managed tasks'
  Assert-True (Test-Path -LiteralPath (Join-Path $work 'data/logs/windows-api.log')) 'Background logs are available'

  # Reinstall is idempotent; it replaces only this directory's own tasks.
  & (Join-Path $work 'scripts/install-windows-autostart.ps1') -RepoPath $work
  Assert-True ((Read-Service $apiPort).marker -eq (Split-Path -Leaf $work)) 'Repeated installation works'

  # A different command attached to the same task name must never be stopped/overwritten.
  $originalXml = Export-ScheduledTask -TaskName $names.api
  try {
    Stop-ScheduledTask -TaskName $names.api
    $alien = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit 0'
    Register-ScheduledTask -TaskName $names.api -Action $alien -Force | Out-Null
    $caught = $null
    try { Get-MssServiceTask $work $names.api 'api' | Out-Null } catch { $caught = $_ }
    Assert-True ($null -ne $caught -and "$caught" -match 'does not belong') 'Unrelated task with a colliding name is protected'
  } finally { Register-ScheduledTask -TaskName $names.api -Xml $originalXml -Force | Out-Null }
  & (Join-Path $work 'scripts/install-auto-update-task.ps1') -RepoPath $work -TaskName $updateTaskName
  Assert-True ((Get-ScheduledTask -TaskName $updateTaskName).Principal.RunLevel -eq 'Highest') 'Reinstalling the hourly updater retains required elevation'
  Write-Host 'All Windows autostart tests passed (real SYSTEM tasks, recovery, update restart, idempotency and ownership).'
} catch {
  foreach ($service in @('api','web')) {
    $log = Join-Path $work "data/logs/windows-$service.log"
    if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 30 | Out-Host }
    Get-ScheduledTaskInfo -TaskName $names[$service] -ErrorAction SilentlyContinue | Format-List | Out-Host
  }
  throw
} finally {
  # Stop before unregistering: the normal helper validates task ownership first.
  try { & (Join-Path $work 'scripts/stop-windows.ps1') -RepoPath $work } catch { Write-Warning $_ }
  foreach ($name in @($names.api,$names.web)) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
      Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $name -Confirm:$false
    }
  }
  if (Get-ScheduledTask -TaskName $updateTaskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $updateTaskName -Confirm:$false }
  Set-Location -LiteralPath $repo
  Remove-Item -LiteralPath $work -Recurse -Force
}
