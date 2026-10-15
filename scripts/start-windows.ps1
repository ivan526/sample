# Launch MSS frontend and backend in separate visible PowerShell windows.
# Called by update-windows.ps1 after a successful update (or when already current).
param(
  [string]$RepoPath = (Split-Path -Parent $PSScriptRoot),
  [switch]$RequireFreePorts
)
$ErrorActionPreference = "Stop"
$RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path
$launcher = Join-Path $RepoPath "scripts\run-windows-service.ps1"
if (-not (Test-Path -LiteralPath $launcher)) { throw "Missing launcher: $launcher" }
if (-not (Get-Command "npm.cmd" -ErrorAction SilentlyContinue)) { throw "npm.cmd not found in PATH" }

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
Write-Host "Startup commands sent. Check both PowerShell windows for actual startup success."
