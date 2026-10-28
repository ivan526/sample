# Keep the application in its own visible PowerShell console.
param(
  [ValidateSet("api", "web")]
  [string]$Service,
  [string]$RepoPath = (Split-Path -Parent $PSScriptRoot),
  [switch]$Background,
  [string]$NodeExecutable = ''
)
$ErrorActionPreference = "Stop"
$RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path
Set-Location -LiteralPath $RepoPath
if ($Background) {
  # The task remains running while Node runs; a nonzero result activates Scheduler recovery.
  # Use the installed absolute Node path; SYSTEM has no interactive user's npm/PATH.
  $logDir = Join-Path $RepoPath 'data/logs'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $log = Join-Path $logDir ("windows-$Service.log")
  if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 10MB) {
    Move-Item -LiteralPath $log -Destination "$log.previous" -Force
  }
  try {
    Add-Content -LiteralPath $log -Value ("`n[{0}] Starting {1}" -f (Get-Date -Format o), $Service)
    if (-not [IO.Path]::IsPathRooted($NodeExecutable) -or -not (Test-Path -LiteralPath $NodeExecutable)) { throw 'Configured node.exe was not found. Re-run the autostart installer.' }
    $env:PATH = (Split-Path -Parent $NodeExecutable) + ';' + $env:PATH
    if ($Service -eq 'api') {
      $nodeArgs = @((Join-Path $RepoPath 'node_modules/tsx/dist/cli.mjs'), (Join-Path $RepoPath 'server/src/index.ts'))
    } else {
      $nodeArgs = @((Join-Path $RepoPath 'node_modules/vite/bin/vite.js'), '--strictPort')
    }
    # Windows PowerShell treats native stderr as ErrorRecord under Stop; retain startup
    # diagnostics without terminating a healthy Node process on a warning.
    $ErrorActionPreference = 'Continue'
    & $NodeExecutable @nodeArgs >> $log 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Add-Content -LiteralPath $log -Value ("[{0}] {1} exited: {2}" -f (Get-Date -Format o), $Service, $code)
  } catch {
    Add-Content -LiteralPath $log -Value ("[{0}] Startup failed: {1}" -f (Get-Date -Format o), $_)
  }
  # An application server should not exit by itself, even with code 0.
  exit 1
}
if ($Service -eq "api") {
  $Host.UI.RawUI.WindowTitle = "MSS Sample - Backend API"
  Write-Host "Starting MSS backend API..."
  & npm.cmd run dev:api:ts
} else {
  $Host.UI.RawUI.WindowTitle = "MSS Sample - Frontend"
  Write-Host "Starting MSS frontend..."
  & npm.cmd run dev
}
Write-Host "Service exited (code $LASTEXITCODE). Review logs above."
