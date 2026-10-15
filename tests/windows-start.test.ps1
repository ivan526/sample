# Exercise startup decisions without launching real service windows.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $repo 'scripts/start-windows.ps1'
$work = Join-Path ([IO.Path]::GetTempPath()) ('mss startup test ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $work 'scripts') -Force | Out-Null
$stop = @'
param([string]$RepoPath)
Set-Content (Join-Path $RepoPath 'stopped.txt') 'stopped'
'@
Set-Content (Join-Path $work 'scripts/stop-windows.ps1') $stop -Encoding UTF8
Set-Content (Join-Path $work 'scripts/run-windows-service.ps1') '# mock launcher' -Encoding UTF8
function npm.cmd { }
function Start-Process($FilePath, $ArgumentList, $WorkingDirectory) {
  $global:windowsStartTestLaunches += @($ArgumentList -join ' ')
}
function Invoke-WebRequest($Uri, [switch]$UseBasicParsing, $TimeoutSec) {
  $global:windowsStartTestProbes += $Uri
  return [pscustomobject]@{ StatusCode = 200 }
}
function Assert-True($Condition, $Message) {
  if (-not $Condition) { throw "FAIL: $Message" }
}
function Reset-Case {
  $global:LASTEXITCODE = 0
  $global:windowsStartTestLaunches = @()
  $global:windowsStartTestProbes = @()
  Remove-Item (Join-Path $work 'stopped.txt') -ErrorAction SilentlyContinue
}
$api = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$web = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
try {
  $api.Start(); $web.Start()
  $apiPort = $api.LocalEndpoint.Port
  $webPort = $web.LocalEndpoint.Port
  $api.Stop(); $web.Stop()
  Set-Content (Join-Path $work '.env') "MSS_API_PORT=$apiPort`nVITE_DEV_PORT=$webPort" -Encoding UTF8
  $Pm2Names = '' # Older updater caller parameter.

  Reset-Case
  & $launcher -RepoPath $work
  Assert-True (Test-Path (Join-Path $work 'stopped.txt')) 'Old update callers trigger shutdown on the first upgrade'
  Assert-True ($global:windowsStartTestLaunches.Count -eq 2) 'Both new service windows are launched'
  Assert-True ($global:windowsStartTestProbes.Count -eq 2) 'Default startup waits for HTTP readiness'

  Reset-Case
  & $launcher -RepoPath $work -KeepRunning
  Assert-True (-not (Test-Path (Join-Path $work 'stopped.txt'))) 'Current-version checks do not restart running services'
  Assert-True ($global:windowsStartTestLaunches.Count -eq 2) 'Missing services are started'

  Reset-Case
  & $launcher -RepoPath $work -RequireFreePorts
  Assert-True (-not (Test-Path (Join-Path $work 'stopped.txt'))) 'An updater that already stopped services does not stop them twice'

  # Occupied ports represent existing services; readiness is mocked above.
  $api = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $apiPort)
  $web = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $webPort)
  $api.Start(); $web.Start()
  Reset-Case
  $Pm2Names = 'api,web'
  & $launcher -RepoPath $work
  Assert-True (-not (Test-Path (Join-Path $work 'stopped.txt'))) 'Old named-PM2 callers keep their already-restarted processes'
  Assert-True ($global:windowsStartTestLaunches.Count -eq 0) 'No duplicate windows for running PM2 services'

  Reset-Case
  $Pm2Names = ''
  $caught = $null
  try { & $launcher -RepoPath $work } catch { $caught = $_ }
  Assert-True ($null -ne $caught -and "$caught" -match 'still occupied') 'Unknown occupied ports abort automatic restart'
  Assert-True ($global:windowsStartTestLaunches.Count -eq 0) 'No partial launch when ports remain occupied'
  Write-Host 'All Windows startup tests passed.'
} finally {
  $api.Stop(); $web.Stop()
  Remove-Item -LiteralPath $work -Recurse -Force
}
