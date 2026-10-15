# Run with Windows PowerShell 5.1: powershell -File tests/windows-stop.test.ps1
# Process enumeration and termination are mocked; no actual process is stopped.
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stopScript = Join-Path $repo "scripts/stop-windows.ps1"
$script:serviceId = $PID + 100

function New-ProcessRecord($Id, $Name, $Command, $Parent = 0) {
  [pscustomobject]@{
    ProcessId = $Id; Name = $Name; CommandLine = $Command
    ParentProcessId = $Parent; CreationDate = [datetime]'2026-01-01'
  }
}
function Reset-Processes($Records) {
  $script:records = @(New-ProcessRecord $PID 'powershell.exe' 'test harness') + @($Records)
  $script:killed = @()
  $script:denyStop = $false
  $script:reuseId = $false
}
function Get-CimInstance($ClassName, $Filter) {
  if ($Filter) {
    $idValue = [int]($Filter -replace '\D', '')
    $record = $script:records | Where-Object { $_.ProcessId -eq $idValue }
    if ($script:reuseId -and $record) {
      $copy = $record.PSObject.Copy()
      $copy.CreationDate = [datetime]'2026-01-02'
      return $copy
    }
    return $record
  }
  return $script:records
}
function taskkill.exe {
  $idValue = [int]$args[1]
  if ($script:denyStop) { $global:LASTEXITCODE = 1; return }
  $ids = @($idValue)
  do {
    $children = @($script:records | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids })
    $ids += @($children | ForEach-Object { $_.ProcessId })
  } while ($children.Count -gt 0)
  $script:killed += $ids
  $script:records = @($script:records | Where-Object { $_.ProcessId -notin $ids })
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
  (New-ProcessRecord $script:serviceId 'node.exe' "node `"$nodePath`""),
  (New-ProcessRecord ($script:serviceId + 1) 'node.exe' "node `"$repo-other\node_modules\vite\bin\vite.js`""),
  (New-ProcessRecord ($script:serviceId + 2) 'node.exe' 'node dist/api/index.js'),
  (New-ProcessRecord ($script:serviceId + 3) 'node.exe' "node `"$repo\tools\job.js`"")
)
& $stopScript -RepoPath $repo
Assert-True ($script:killed.Count -eq 1 -and $script:killed[0] -eq $script:serviceId) 'Only this project service is stopped'

Reset-Processes @(
  (New-ProcessRecord $script:serviceId 'node.exe' "node `"$repo\node_modules\.bin\\..\tsx\dist\cli.mjs`" server/src/index.ts")
)
& $stopScript -RepoPath $repo
Assert-True ($script:killed -contains $script:serviceId) 'Windows npm shim path is recognized'

Reset-Processes @(
  (New-ProcessRecord $script:serviceId 'powershell.exe' "powershell -File `"$repo\scripts\run-windows-service.ps1`" -Service api"),
  (New-ProcessRecord ($script:serviceId + 1) 'node.exe' 'node dist/api/index.js' $script:serviceId)
)
& $stopScript -RepoPath $repo
Assert-True ($script:killed.Count -eq 2) 'Launcher children are stopped together'

Reset-Processes @(
  (New-ProcessRecord $script:serviceId 'node.exe' "node `"$nodePath`"")
)
$script:denyStop = $true
Assert-Throws 'Could not stop process'

Reset-Processes @(
  (New-ProcessRecord $script:serviceId 'node.exe' "node `"$nodePath`"")
)
$script:reuseId = $true
Assert-Throws 'changed during shutdown'
Assert-True ($script:killed.Count -eq 0) 'A reused PID is never stopped'

Reset-Processes @(
  (New-ProcessRecord $script:serviceId 'node.exe' "node `"$nodePath`"" ($script:serviceId + 1)),
  (New-ProcessRecord ($script:serviceId + 1) 'node.exe' 'node C:\tools\pm2\lib\Daemon.js')
)
Assert-Throws 'managed by PM2'
Assert-True ($script:killed.Count -eq 0) 'Supervised services require PM2 stop'

Reset-Processes @()
& $stopScript -RepoPath $repo
Assert-True ($script:killed.Count -eq 0) 'Stopping an already stopped project succeeds'
Write-Host 'All Windows shutdown tests passed.'
