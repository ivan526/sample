# Stop only services whose command line identifies this project.
param(
  [string]$RepoPath = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = "Stop"
$RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path.TrimEnd('\','/')
if (-not (Test-Path -LiteralPath (Join-Path $RepoPath "server/src/index.ts"))) {
  throw "Not an MSS application directory: $RepoPath"
}

function Normalize-CommandPath([string]$Value) {
  # npm's Windows shims use node_modules\.bin\\..\vite (or tsx).
  return ($Value.Replace('/', '\') -replace '\\+', '\').Replace('\.bin\..\', '\')
}
$root = Normalize-CommandPath $RepoPath
$entries = @(
  "$root\scripts\run-windows-service.ps1",
  "$root\node_modules\vite\bin\vite.js",
  "$root\node_modules\tsx\dist\cli.mjs",
  "$root\node_modules\tsx\dist\preflight.cjs",
  "$root\server\src\index.ts",
  "$root\dist\api\index.js",
  "$root\server\index.mjs"
)
$entryPattern = '(?i)(?:^|[\s"''])(' + (($entries | ForEach-Object { [regex]::Escape($_) }) -join '|') + ')(?=$|[\s"''])'
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
  $_.Name -match '^(node|powershell|pwsh)\.exe$' -and
  (Normalize-CommandPath ([string]$_.CommandLine)) -match $entryPattern
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
      (Normalize-CommandPath ([string]$current.CommandLine)) -notmatch $entryPattern) {
    throw "Process $processId changed during shutdown; refusing to stop it."
  }
  Write-Host "Stopping project service: $($current.Name) (PID $processId)"
  & taskkill.exe /PID $processId /T /F
  if ($LASTEXITCODE -ne 0 -and (Get-CimInstance Win32_Process -Filter "ProcessId = $processId")) {
    throw "Could not stop process $processId. Startup aborted."
  }
}
Write-Host "Project service shutdown completed."
