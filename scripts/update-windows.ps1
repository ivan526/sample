# MSS Windows ZIP updater: Git is NOT required on the deployment machine.
# Public repo: https://github.com/ivan526/sample
# This overlays application files, but preserves .env, data, node_modules, dist and .git.
param(
  [string]$RepoPath = (Split-Path -Parent $PSScriptRoot),
  [string]$ProxyUrl = "http://proxyblr.huawei.com:8080",
  [string]$ProxyCredentialFile = (Join-Path $env:APPDATA "MSS-Sample\proxy-credential.xml"),
  [string]$Pm2Names = "",
  [switch]$RunTests,
  [switch]$CheckOnly,
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Checked {
  param([string]$Program, [string[]]$Arguments)
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Program $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

# Enumerate only application files. Never copy/overwrite SQLite, credentials or installed packages.
$protectedRootNames = @(".git", "data", "node_modules", "dist", ".env", ".env.local", ".env.production", ".env.development", ".env.test")
function Get-ApplicationFiles([string]$Root) {
  foreach ($entry in @(Get-ChildItem -LiteralPath $Root -Force)) {
    if ($protectedRootNames -contains $entry.Name) { continue }
    if ($entry.PSIsContainer) {
      foreach ($file in @(Get-ChildItem -LiteralPath $entry.FullName -Recurse -File -Force)) {
        # Ignore nested local-only configuration/dependencies as well.
        $relative = $file.FullName.Substring($Root.Length).TrimStart('\','/')
        if ($relative -match '(^|[\\/])(\.git|data|node_modules|dist)([\\/]|$)' -or $file.Name -match '^\.env(\.|$)') { continue }
        $file
      }
    } else {
      if ($entry.Name -match '^\.env(\.|$)') { continue }
      $entry
    }
  }
}

function Copy-RelativeFile([string]$SourcePath, [string]$SourceRoot, [string]$DestinationRoot) {
  $relative = $SourcePath.Substring($SourceRoot.Length).TrimStart('\','/')
  $destination = Join-Path $DestinationRoot $relative
  $parent = Split-Path -Parent $destination
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  Copy-Item -LiteralPath $SourcePath -Destination $destination -Force
  return $destination
}

$work = $null
$backupSource = $null
$createdFiles = New-Object 'System.Collections.Generic.List[string]'
$modified = $false
$stoppedNames = @()

try {
  $RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path.TrimEnd('\','/')
  Set-Location -LiteralPath $RepoPath
  if (-not (Test-Path "package.json") -or -not (Test-Path "server/src/index.ts")) {
    throw "Not an MSS application directory: $RepoPath"
  }
  foreach ($program in @("node.exe", "npm.cmd")) {
    if (-not (Get-Command $program -ErrorAction SilentlyContinue)) { throw "Missing required program: $program" }
  }

  $dataDir = Join-Path $RepoPath "data"
  if (-not (Test-Path -LiteralPath $dataDir)) { throw "Data folder is missing. Aborting to protect the database." }
  $work = Join-Path $dataDir ("zip-update-work-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work -Force | Out-Null
  $zip = Join-Path $work "main.zip"

  $downloadArgs = @{
    Uri = "https://github.com/ivan526/sample/archive/refs/heads/main.zip"
    OutFile = $zip
    UseBasicParsing = $true
    MaximumRedirection = 5
    TimeoutSec = 180
    Headers = @{ "User-Agent" = "MSS-Sample-Windows-Updater" }
  }
  if ($ProxyUrl.Trim()) {
    $downloadArgs.Proxy = $ProxyUrl
    if (Test-Path -LiteralPath $ProxyCredentialFile) {
      $credential = Import-Clixml -LiteralPath $ProxyCredentialFile
      if ($credential -isnot [System.Management.Automation.PSCredential]) {
        throw "ProxyCredentialFile is not a PowerShell credential"
      }
      $downloadArgs.ProxyCredential = $credential
    } else {
      $downloadArgs.ProxyUseDefaultCredentials = $true
    }
  }
  Write-Host "Downloading GitHub main ZIP through configured HTTP proxy ..."
  Invoke-WebRequest @downloadArgs
  if ((Get-Item -LiteralPath $zip).Length -lt 1000) { throw "Downloaded ZIP is unexpectedly small" }
  $zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
  $stateFile = Join-Path $dataDir "zip-update-last-success.sha256"
  if ((Test-Path -LiteralPath $stateFile) -and ((Get-Content -LiteralPath $stateFile -Raw).Trim() -eq $zipHash)) {
    Write-Host "Already up to date; no files changed."
    exit 0
  }
  Write-Host "New ZIP archive detected (SHA256: $zipHash)"
  if ($CheckOnly) { exit 0 }

  $unpack = Join-Path $work "unpacked"
  Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
  $source = @(Get-ChildItem -LiteralPath $unpack -Directory | Where-Object { Test-Path (Join-Path $_.FullName "package.json") })
  if ($source.Count -ne 1 -or -not (Test-Path (Join-Path $source[0].FullName "server/src/index.ts"))) {
    throw "Downloaded ZIP does not contain the expected project"
  }
  $sourceRoot = $source[0].FullName

  # Require a valid SQLite backup before replacing any application files.
  if (-not (Test-Path "scripts/backup-sqlite.cjs")) {
    throw "Missing scripts/backup-sqlite.cjs. Install the current scripts once before auto-updating."
  }
  if (-not (Test-Path "node_modules/better-sqlite3")) {
    throw "Please run npm install once before the first update, for safe SQLite backup."
  }
  Invoke-Checked "node.exe" @("scripts/backup-sqlite.cjs")

  $names = @($Pm2Names.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($names.Count -gt 0) {
    if (-not (Get-Command "pm2.cmd" -ErrorAction SilentlyContinue)) {
      throw "PM2 is not available. Remove -Pm2Names or install/configure PM2 first."
    }
    foreach ($name in $names) {
      Invoke-Checked "pm2.cmd" @("stop", $name)
      $stoppedNames += $name
    }
  } else {
    Write-Warning "No PM2 names set: existing running applications will NOT be restarted automatically."
  }

  # Save a restorable snapshot of the old application files (not the database).
  $backupSource = Join-Path $dataDir ("updates\code-before-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  New-Item -ItemType Directory -Path $backupSource -Force | Out-Null
  foreach ($file in @(Get-ApplicationFiles $RepoPath)) {
    Copy-RelativeFile $file.FullName $RepoPath $backupSource | Out-Null
  }
  Write-Host "Old code backup: $backupSource"

  $modified = $true
  foreach ($file in @(Get-ApplicationFiles $sourceRoot)) {
    $relative = $file.FullName.Substring($sourceRoot.Length).TrimStart('\','/')
    $destination = Join-Path $RepoPath $relative
    if (-not (Test-Path -LiteralPath $destination)) { $createdFiles.Add($destination) }
    Copy-RelativeFile $file.FullName $sourceRoot $RepoPath | Out-Null
  }

  if (-not $SkipNpmInstall) { Invoke-Checked "npm.cmd" @("install", "--no-audit", "--no-fund") }
  Invoke-Checked "npm.cmd" @("run", "build")
  Invoke-Checked "npm.cmd" @("run", "build:server")
  if ($RunTests) { Invoke-Checked "npm.cmd" @("test") }

  # Restart only explicitly named processes. Never kill all node.exe instances.
  foreach ($name in $stoppedNames) { Invoke-Checked "pm2.cmd" @("restart", $name, "--update-env") }
  if ($stoppedNames.Count -gt 0) { Invoke-Checked "pm2.cmd" @("save") }
  $modified = $false
  Set-Content -LiteralPath $stateFile -Value $zipHash -Encoding ASCII
  Write-Host "ZIP update completed successfully."
} catch {
  Write-Warning "Update failed: $_"
  if ($modified -and $backupSource -and (Test-Path -LiteralPath $backupSource)) {
    Write-Warning "Attempting to restore previous application files (SQLite is untouched)..."
    foreach ($file in $createdFiles) {
      if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file -Force }
    }
    foreach ($file in @(Get-ApplicationFiles $backupSource)) {
      Copy-RelativeFile $file.FullName $backupSource $RepoPath | Out-Null
    }
    try {
      if (-not $SkipNpmInstall) { Invoke-Checked "npm.cmd" @("install", "--no-audit", "--no-fund") }
      Invoke-Checked "npm.cmd" @("run", "build")
      Invoke-Checked "npm.cmd" @("run", "build:server")
    } catch { Write-Warning "Rollback build failed: $_" }
  }
  foreach ($name in $stoppedNames) {
    try { Invoke-Checked "pm2.cmd" @("restart", $name, "--update-env") }
    catch { Write-Warning "Could not restart $name : $_" }
  }
  exit 1
} finally {
  if ($work -and (Test-Path -LiteralPath $work)) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}
