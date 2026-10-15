# Child-process harness. No network, SQLite, npm, or actual service processes are used.
param([string]$Updater, [string]$RepoPath, [string]$Archive, [string]$Scenario)
$ErrorActionPreference = 'Stop'
$global:mockBuildFailed = $false
# Named parameters are required because the updater passes a download hashtable.
function Invoke-WebRequest {
  param($Uri, $OutFile, $UseBasicParsing, $MaximumRedirection, $TimeoutSec, $Headers)
  Copy-Item -LiteralPath $Archive -Destination $OutFile
}
function node.exe {
  Add-Content (Join-Path $RepoPath 'data/calls.txt') 'backup'
  $global:LASTEXITCODE = 0
}
function npm.cmd {
  $operation = $args -join ' '
  Add-Content (Join-Path $RepoPath 'data/calls.txt') $operation
  if ($Scenario -eq 'build-fails' -and $operation -eq 'run build' -and -not $global:mockBuildFailed) {
    $global:mockBuildFailed = $true
    $global:LASTEXITCODE = 1
  } else { $global:LASTEXITCODE = 0 }
}
function pm2.cmd {
  Add-Content (Join-Path $RepoPath 'data/calls.txt') ('pm2 ' + ($args -join ' '))
  $global:LASTEXITCODE = 0
}
$options = @{ RepoPath = $RepoPath; ProxyUrl = ''; SkipNpmInstall = $true }
if ($Scenario -eq 'check-only') { $options.CheckOnly = $true }
if ($Scenario -eq 'no-start') { $options.NoStart = $true }
if ($Scenario -eq 'pm2') { $options.Pm2Names = 'api,web' }
& $Updater @options
exit $LASTEXITCODE
