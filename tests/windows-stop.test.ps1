# Run with Windows PowerShell 5.1: powershell -File tests/windows-stop.test.ps1
# Process enumeration and termination are mocked; no actual process is stopped.
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stopScript = Join-Path $repo "scripts/stop-windows.ps1"
$global:windowsStopTestServiceId = $PID + 100

function New-ProcessRecord($Id, $Name, $Command, $Parent = 0) {
  [pscustomobject]@{
    ProcessId = $Id; Name = $Name; CommandLine = $Command
    ParentProcessId = $Parent; CreationDate = [datetime]'2026-01-01'
  }
}
function Reset-Processes($Records) {
  $global:windowsStopTestRecords = @(New-ProcessRecord $PID 'powershell.exe' 'test harness') + @($Records)
  $global:windowsStopTestKilled = @()
  $global:windowsStopTestDenyStop = $false
  $global:windowsStopTestReuseId = $false
}
function Get-CimInstance($ClassName, $Filter) {
  if ($Filter) {
    $idValue = [int]($Filter -replace '\D', '')
    $record = $global:windowsStopTestRecords | Where-Object { $_.ProcessId -eq $idValue }
    if ($global:windowsStopTestReuseId -and $record) {
      $copy = $record.PSObject.Copy()
      $copy.CreationDate = [datetime]'2026-01-02'
      return $copy
    }
    return $record
  }
  return $global:windowsStopTestRecords
}
function taskkill.exe {
  $idValue = [int]$args[1]
  if ($global:windowsStopTestDenyStop) { $global:LASTEXITCODE = 1; return }
  $ids = @($idValue)
  do {
    $children = @($global:windowsStopTestRecords | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids })
    $ids += @($children | ForEach-Object { $_.ProcessId })
  } while ($children.Count -gt 0)
  $global:windowsStopTestKilled += $ids
  $global:windowsStopTestRecords = @($global:windowsStopTestRecords | Where-Object { $_.ProcessId -notin $ids })
  $global:LASTEXITCODE = 0
}
function Assert-True($Value, $Message) {
  if (-not $Value) { throw "FAIL: $Message" }
}
function Assert-Throws($Pattern) {
  $caught = $null
  try { & $stopScript -RepoPath $repo } catch { $caught = $_ }
  Assert-True ($null -ne $caught -and "$caught" -match $Pattern) "Expected error: $Pattern; got: $caught"
}

$nodePath = "$repo\node_modules\vite\bin\vite.js"
Reset-Processes @(
  (New-ProcessRecord $global:windowsStopTestServiceId 'node.exe' "node `"$nodePath`""),
  (New-ProcessRecord ($global:windowsStopTestServiceId + 1) 'node.exe' "node `"$repo-other\node_modules\vite\bin\vite.js`""),
  (New-ProcessRecord ($global:windowsStopTestServiceId + 2) 'node.exe' 'node dist/api/index.js'),
  (New-ProcessRecord ($global:windowsStopTestServiceId + 3) 'node.exe' "node `"$repo\tools\job.js`""),
  (New-ProcessRecord ($global:windowsStopTestServiceId + 4) 'node.exe' "node `"$repo\node_modules\tsx\dist\cli.mjs`" server/src/db/load-huawei-test-data.ts")
)
& $stopScript -RepoPath $repo
Assert-True ($global:windowsStopTestKilled.Count -eq 1 -and $global:windowsStopTestKilled[0] -eq $global:windowsStopTestServiceId) 'Only this project service is stopped'

Reset-Processes @(
  (New-ProcessRecord $global:windowsStopTestServiceId 'node.exe' "node `"$repo\node_modules\.bin\\..\tsx\dist\cli.mjs`" server/src/index.ts")
)
& $stopScript -RepoPath $repo
Assert-True ($global:windowsStopTestKilled -contains $global:windowsStopTestServiceId) 'Windows npm shim path is recognized'

Reset-Processes @(
  (New-ProcessRecord $global:windowsStopTestServiceId 'powershell.exe' "powershell -File `"$repo\scripts\run-windows-service.ps1`" -Service api"),
  (New-ProcessRecord ($global:windowsStopTestServiceId + 1) 'node.exe' 'node dist/api/index.js' $global:windowsStopTestServiceId)
)
& $stopScript -RepoPath $repo
Assert-True ($global:windowsStopTestKilled.Count -eq 2) 'Launcher children are stopped together'

Reset-Processes @(
  (New-ProcessRecord $global:windowsStopTestServiceId 'node.exe' "node `"$nodePath`"")
)
$global:windowsStopTestDenyStop = $true
Assert-Throws 'Could not stop process'

Reset-Processes @(
  (New-ProcessRecord $global:windowsStopTestServiceId 'node.exe' "node `"$nodePath`"")
)
$global:windowsStopTestReuseId = $true
Assert-Throws 'changed during shutdown'
Assert-True ($global:windowsStopTestKilled.Count -eq 0) 'A reused PID is never stopped'

Reset-Processes @(
  (New-ProcessRecord $global:windowsStopTestServiceId 'node.exe' "node `"$nodePath`"" ($global:windowsStopTestServiceId + 1)),
  (New-ProcessRecord ($global:windowsStopTestServiceId + 1) 'node.exe' 'node C:\tools\pm2\lib\Daemon.js')
)
Assert-Throws 'managed by PM2'
Assert-True ($global:windowsStopTestKilled.Count -eq 0) 'Supervised services require PM2 stop'

Reset-Processes @()
& $stopScript -RepoPath $repo
Assert-True ($global:windowsStopTestKilled.Count -eq 0) 'Stopping an already stopped project succeeds'
Write-Host 'All Windows shutdown tests passed.'
