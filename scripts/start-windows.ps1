# Launch MSS frontend and backend in separate visible PowerShell windows.
# Called by update-windows.ps1 after a successful update (or when already current).
param(
  [string]$RepoPath = (Split-Path -Parent $PSScriptRoot),
  [switch]$RequireFreePorts,
  [switch]$WaitForReady = $true,
  [switch]$KeepRunning
)
$ErrorActionPreference = "Stop"
$RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path
$launcher = Join-Path $RepoPath "scripts\run-windows-service.ps1"
if (-not (Test-Path -LiteralPath $launcher)) { throw "Missing launcher: $launcher" }
$autoStart = $null
if (Test-Path -LiteralPath (Join-Path $RepoPath 'data/windows-autostart.json')) {
  . (Join-Path $RepoPath 'scripts/windows-autostart.ps1')
  Assert-MssAdministrator
  $autoStart = Get-MssAutoStartConfig $RepoPath
  foreach ($name in @('api','web')) { Get-MssServiceTask $RepoPath $autoStart."$($name)Task" $name | Out-Null }
} elseif (-not (Get-Command "npm.cmd" -ErrorAction SilentlyContinue)) { throw "npm.cmd not found in PATH" }

# An older updater has already been parsed when it overwrites itself. Its final
# call reaches this new launcher, which must restart the old processes on that
# first update too. New updaters explicitly keep a known-current version alive.
# Older PM2 callers already perform their own named restart before launching.
$callerPm2Names = Get-Variable -Name Pm2Names -Scope 1 -ValueOnly -ErrorAction SilentlyContinue
if (-not $KeepRunning -and -not $RequireFreePorts -and [string]::IsNullOrWhiteSpace([string]$callerPm2Names)) {
  & (Join-Path $RepoPath "scripts/stop-windows.ps1") -RepoPath $RepoPath
  if (-not $?) { throw "Project service shutdown failed" }
  $RequireFreePorts = $true
}

# Check expected configured ports; do not terminate or steal ports from other applications.
$apiPort = 8787
$webPort = 5173
$dotenv = Join-Path $RepoPath ".env"
if (Test-Path $dotenv) {
  foreach ($line in (Get-Content -LiteralPath $dotenv)) {
    if ($line -match '^\s*MSS_API_PORT\s*=\s*(\d+)\s*$') { $apiPort = [int]$Matches[1] }
    if ($line -match '^\s*VITE_DEV_PORT\s*=\s*(\d+)\s*$') { $webPort = [int]$Matches[1] }
  }
}
function Test-PortListening([int]$Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(250)) { return $false }
    try { $client.EndConnect($async); return $true } catch { return $false }
  } finally { $client.Close() }
}
$services = @(
  @{ Name = "api"; Port = $apiPort; Label = "后端API" },
  @{ Name = "web"; Port = $webPort; Label = "前端Vite" }
)
if ($RequireFreePorts) {
  foreach ($service in $services) {
    if (Test-PortListening $service.Port) {
      throw "Port $($service.Port) is still occupied. Stop the service in its original window before restarting."
    }
  }
}
foreach ($service in $services) {
  if ($autoStart) {
    $taskName = $autoStart."$($service.Name)Task"
    $task = Get-MssServiceTask $RepoPath $taskName $service.Name
    if ($task.State -eq 'Disabled') { throw "Autostart task $taskName is disabled. Re-enable it in Task Scheduler." }
    if ($task.State -ne 'Running') {
      if (Test-PortListening $service.Port) { throw "Port $($service.Port) is occupied outside the stopped autostart task. Stop the old service first." }
      Start-ScheduledTask -TaskPath '\' -TaskName $taskName
      Write-Host "Started background service task: $taskName"
    }
    continue
  }
  if (Test-PortListening $service.Port) {
    Write-Warning "$($service.Label) port $($service.Port) is already occupied. Skipping launch; verify that this is the correct running service."
    continue
  }
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-NoExit",
    "-File", ('"' + $launcher + '"'),
    "-Service", $service.Name,
    "-RepoPath", ('"' + $RepoPath + '"')
  )
  Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory $RepoPath
  Write-Host "Launched $($service.Label) in a separate PowerShell window (expected port $($service.Port))."
}
if ($WaitForReady) {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    $ready = $false
    try {
      $api = Invoke-WebRequest -Uri "http://127.0.0.1:$apiPort/api/v1/healthz" -UseBasicParsing -TimeoutSec 2
      $web = Invoke-WebRequest -Uri "http://127.0.0.1:$webPort/@vite/client" -UseBasicParsing -TimeoutSec 2
      $ready = $api.StatusCode -eq 200 -and $web.StatusCode -eq 200
    } catch { $ready = $false }
    if ($ready) {
      Write-Host "Backend API and frontend are ready."
      return
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw "Services did not become ready within 45 seconds. Check the backend/frontend windows or data/logs for autostart tasks."
}
Write-Host "Startup commands sent. Check both PowerShell windows for actual startup success."
