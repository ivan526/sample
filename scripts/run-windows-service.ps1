# Run a supervised background task or a legacy visible service console.
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
  # Keep the task running and supervise Node directly, including demand-started tasks.
  # Use the installed absolute Node path; SYSTEM has no interactive user's npm/PATH.
  $logDir = Join-Path $RepoPath 'data/logs'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $log = Join-Path $logDir ("windows-$Service.log")
  while ($true) {
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 10MB) {
      Move-Item -LiteralPath $log -Destination "$log.previous" -Force
    }
    try {
      Add-Content -LiteralPath $log -Encoding UTF8 -Value ("`n[{0}] Starting {1}" -f (Get-Date -Format o), $Service)
      if (-not [IO.Path]::IsPathRooted($NodeExecutable) -or -not (Test-Path -LiteralPath $NodeExecutable)) { throw 'Configured node.exe was not found. Re-run the autostart installer.' }
      $nodeDir = Split-Path -Parent $NodeExecutable
      if ($env:PATH.Split(';') -notcontains $nodeDir) { $env:PATH = $nodeDir + ';' + $env:PATH }
      if ($Service -eq 'api') {
        $nodeArgs = @((Join-Path $RepoPath 'node_modules/tsx/dist/cli.mjs'), (Join-Path $RepoPath 'server/src/index.ts'))
      } else {
        $nodeArgs = @((Join-Path $RepoPath 'node_modules/vite/bin/vite.js'), '--strictPort')
      }
      # Windows PowerShell treats native stderr as ErrorRecord under Stop; retain startup
      # diagnostics without terminating a healthy Node process on a warning.
      $ErrorActionPreference = 'Continue'
      & $NodeExecutable @nodeArgs 2>&1 | Out-File -LiteralPath $log -Append -Encoding UTF8
      $code = $LASTEXITCODE
      $ErrorActionPreference = 'Stop'
      Add-Content -LiteralPath $log -Encoding UTF8 -Value ("[{0}] {1} exited: {2}" -f (Get-Date -Format o), $Service, $code)
    } catch {
      $ErrorActionPreference = 'Stop'
      Add-Content -LiteralPath $log -Encoding UTF8 -Value ("[{0}] Startup failed: {1}" -f (Get-Date -Format o), $_)
    }
    # Scheduler recovery alone is not sufficient for demand-started tasks. This
    # loop also recovers clean exits; stop-windows stops this task before its child.
    Add-Content -LiteralPath $log -Encoding UTF8 -Value 'Retrying in 60 seconds; stop the scheduled task for maintenance.'
    Start-Sleep -Seconds 60
  }
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
