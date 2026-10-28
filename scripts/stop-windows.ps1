# Stop only services whose command line identifies this project.
param(
  [string]$RepoPath = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = "Stop"
$RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path.TrimEnd('\','/')
if (-not (Test-Path -LiteralPath (Join-Path $RepoPath "server/src/index.ts"))) {
  throw "Not an MSS application directory: $RepoPath"
}
if (Test-Path -LiteralPath (Join-Path $RepoPath 'data/windows-autostart.json')) {
  . (Join-Path $RepoPath 'scripts/windows-autostart.ps1')
  Assert-MssAdministrator
  $config = Get-MssAutoStartConfig $RepoPath
  # Stop the supervisors first so scheduled recovery cannot race a code update.
  foreach ($name in @('api','web')) { Get-MssServiceTask $RepoPath $config."$($name)Task" $name | Out-Null }
  foreach ($name in @('api','web')) {
    $taskName = $config."$($name)Task"
    Stop-ScheduledTask -TaskPath '\' -TaskName $taskName
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-ScheduledTask -TaskPath '\' -TaskName $taskName).State -eq 'Running') {
      if ((Get-Date) -ge $deadline) { throw "Scheduled task $taskName did not stop." }
      Start-Sleep -Milliseconds 200
    }
  }
}

function Normalize-CommandPath([string]$Value) {
  # npm's Windows shims use node_modules\.bin\\..\vite (or tsx).
  return ($Value.Replace('/', '\') -replace '\\+', '\').Replace('\.bin\..\', '\')
}
$root = Normalize-CommandPath $RepoPath
$entries = @(
  "$root\scripts\run-windows-service.ps1",
  "$root\node_modules\vite\bin\vite.js",
  "$root\server\src\index.ts",
  "$root\dist\api\index.js",
  "$root\server\index.mjs"
)
$entryPattern = '(?i)(?:^|[\s"''])(' + (($entries | ForEach-Object { [regex]::Escape($_) }) -join '|') + ')(?=$|[\s"''])'
$tsxPattern = '(?i)(?:^|[\s"''])' + [regex]::Escape("$root\node_modules\tsx\dist\") + '(cli\.mjs|preflight\.cjs)(?=$|[\s"''])'
function Test-ProjectService($Process) {
  if ($Process.Name -notmatch '^(node|powershell|pwsh)\.exe$') { return $false }
  $command = Normalize-CommandPath ([string]$Process.CommandLine)
  if ($command -match $entryPattern) { return $true }
  # A tsx process may run another task (e.g. a data import); only stop API entrypoints.
  return $command -match $tsxPattern -and $command -match '(?i)(?:^|[\s"''])server\\src\\index\.ts(?=$|[\s"''])'
}
$processes = @(Get-CimInstance Win32_Process)
$byId = @{}
foreach ($process in $processes) { $byId[[int]$process.ProcessId] = $process }

# Never stop this command, or a shell/updater that invoked it.
$protectedIds = @{}
$ancestorId = $PID
while ($ancestorId -and $byId.ContainsKey([int]$ancestorId) -and -not $protectedIds.ContainsKey([int]$ancestorId)) {
  $protectedIds[[int]$ancestorId] = $true
  $ancestorId = [int]$byId[[int]$ancestorId].ParentProcessId
}
$targets = @($processes | Where-Object {
  -not $protectedIds.ContainsKey([int]$_.ProcessId) -and
  (Test-ProjectService $_)
})

# A supervisor would immediately respawn a killed child; require its own stop command.
foreach ($target in $targets) {
  $seen = @{}
  $ancestorId = [int]$target.ParentProcessId
  while ($ancestorId -and $byId.ContainsKey($ancestorId) -and -not $seen.ContainsKey($ancestorId)) {
    $seen[$ancestorId] = $true
    $ancestor = $byId[$ancestorId]
    if ($ancestor.CommandLine -match '(?i)(pm2[\\/]lib[\\/]Daemon\.js|PM2.*God Daemon)') {
      throw "A project service is managed by PM2. Stop it with pm2 stop <name>, or use update-windows.ps1 -Pm2Names <name>."
    }
    $ancestorId = [int]$ancestor.ParentProcessId
  }
}

foreach ($target in $targets) {
  $processId = [int]$target.ProcessId
  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
  if (-not $current) { continue } # Already stopped with its parent.
  if ($current.CreationDate -ne $target.CreationDate -or
      -not (Test-ProjectService $current)) {
    throw "Process $processId changed during shutdown; refusing to stop it."
  }
  Write-Host "Stopping project service: $($current.Name) (PID $processId)"
  & taskkill.exe /PID $processId /T /F
  if ($LASTEXITCODE -ne 0 -and (Get-CimInstance Win32_Process -Filter "ProcessId = $processId")) {
    throw "Could not stop process $processId. Startup aborted."
  }
}
Write-Host "Project service shutdown completed."
