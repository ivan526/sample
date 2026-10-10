# Keep the application in its own visible PowerShell console.
param(
  [ValidateSet("api", "web")]
  [string]$Service,
  [string]$RepoPath = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = "Stop"
$RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path
Set-Location -LiteralPath $RepoPath
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
