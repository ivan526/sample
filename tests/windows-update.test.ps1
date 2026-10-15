# Windows PowerShell 5.1 integration tests using isolated ZIP/update fixtures.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$updater = Join-Path $repo 'scripts/update-windows.ps1'
$runner = Join-Path $PSScriptRoot 'fixtures/windows-update-runner.ps1'
$work = Join-Path ([IO.Path]::GetTempPath()) ('mss update test ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null

function Write-File($Root, $Name, $Content) {
  $path = Join-Path $Root $Name
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
  Set-Content -LiteralPath $path -Value $Content -Encoding UTF8
}
function Assert-True($Condition, $Message) {
  if (-not $Condition) { throw "FAIL: $Message" }
}
function Invoke-Update($Root, $Scenario) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -Updater $updater -RepoPath $Root -Archive $archive -Scenario $Scenario | Out-Host
  return $LASTEXITCODE
}
$stop = @'
param([string]$RepoPath)
Add-Content (Join-Path $RepoPath 'data/calls.txt') 'stop'
if (Test-Path (Join-Path $RepoPath 'data/fail-stop.flag')) { throw 'Simulated shutdown failure' }
'@
$start = @'
param([string]$RepoPath, [switch]$RequireFreePorts, [switch]$WaitForReady)
$version = (Get-Content (Join-Path $RepoPath 'server/src/index.ts') -Raw).Trim()
Add-Content (Join-Path $RepoPath 'data/calls.txt') "start:$RequireFreePorts`:$WaitForReady`:$version"
if ($version -eq 'new' -and (Test-Path (Join-Path $RepoPath 'data/fail-start.flag'))) { throw 'Simulated startup failure' }
'@
function New-TestProject($Name) {
  $root = Join-Path $work $Name
  Write-File $root 'server/src/index.ts' 'old'
  Write-File $root 'package.json' '{}'
  Write-File $root 'scripts/backup-sqlite.cjs' '// mock'
  Write-File $root 'scripts/stop-windows.ps1' $stop
  Write-File $root 'scripts/start-windows.ps1' $start
  Write-File $root '.env' 'KEEP_ME=1'
  Write-File $root 'data/keep.txt' 'database stays'
  New-Item -ItemType Directory -Force -Path (Join-Path $root 'node_modules/better-sqlite3') | Out-Null
  return $root
}
try {
  $source = Join-Path $work 'source/project'
  Write-File $source 'package.json' '{}'
  Write-File $source 'server/src/index.ts' 'new'
  # Simulate an older main ZIP: local lifecycle helpers must not be downgraded.
  Write-File $source 'scripts/start-windows.ps1' "throw 'old launcher must not replace installed helper'"
  Write-File $source 'padding.txt' ((1..300 | ForEach-Object { [guid]::NewGuid().ToString() }) -join "`n")
  $archive = Join-Path $work 'main.zip'
  Compress-Archive -Path $source -DestinationPath $archive
  $hash = (Get-FileHash $archive -Algorithm SHA256).Hash

  $root = New-TestProject 'normal'
  Assert-True ((Invoke-Update $root 'normal') -eq 0) 'Update succeeds'
  $calls = (Get-Content (Join-Path $root 'data/calls.txt')) -join ','
  Assert-True ($calls -eq 'backup,stop,run build,run build:server,start:True:True:new') "Update order: $calls"
  Assert-True ((Get-Content (Join-Path $root '.env')).Trim() -eq 'KEEP_ME=1') '.env survives'
  Assert-True ((Get-Content (Join-Path $root 'data/keep.txt')).Trim() -eq 'database stays') 'Data survives'
  Assert-True ((Get-Content (Join-Path $root 'data/zip-update-last-started.sha256')).Trim() -eq $hash) 'Started version is recorded'

  Remove-Item (Join-Path $root 'data/calls.txt')
  Assert-True ((Invoke-Update $root 'normal') -eq 0) 'Same version check succeeds'
  $calls = (Get-Content (Join-Path $root 'data/calls.txt')) -join ','
  Assert-True ($calls -eq 'start:False:True:new') 'Same version only starts missing services'

  $root = New-TestProject 'legacy-current'
  Write-File $root 'data/zip-update-last-success.sha256' $hash
  Assert-True ((Invoke-Update $root 'normal') -eq 0) 'Legacy current version is restarted'
  Assert-True (((Get-Content (Join-Path $root 'data/calls.txt')) -join ',') -eq 'stop,start:True:True:old') 'Old success marker cannot skip restart'

  $root = New-TestProject 'check-only'
  Assert-True ((Invoke-Update $root 'check-only') -eq 0) 'Check-only succeeds'
  Assert-True (-not (Test-Path (Join-Path $root 'data/calls.txt'))) 'Check-only leaves services untouched'
  Assert-True ((Get-Content (Join-Path $root 'server/src/index.ts')).Trim() -eq 'old') 'Check-only leaves source untouched'

  $root = New-TestProject 'no-start'
  Assert-True ((Invoke-Update $root 'no-start') -eq 0) 'NoStart succeeds'
  Assert-True (((Get-Content (Join-Path $root 'data/calls.txt')) -join ',') -eq 'backup,run build,run build:server') 'NoStart does not stop or start services'
  Assert-True (-not (Test-Path (Join-Path $root 'data/zip-update-last-started.sha256'))) 'NoStart cannot mark service version current'

  $root = New-TestProject 'build-fails'
  Assert-True ((Invoke-Update $root 'build-fails') -eq 1) 'Failed build reports failure'
  $calls = (Get-Content (Join-Path $root 'data/calls.txt')) -join ','
  Assert-True ($calls -eq 'backup,stop,run build,stop,run build,run build:server,start:False:True:old') "Failure restores and restarts old source: $calls"
  Assert-True (-not (Test-Path (Join-Path $root 'data/zip-update-last-success.sha256'))) 'Failed update is not recorded as successful'

  $root = New-TestProject 'start-fails'
  Write-File $root 'data/fail-start.flag' '1'
  Assert-True ((Invoke-Update $root 'normal') -eq 1) 'Failed startup reports failure'
  $calls = (Get-Content (Join-Path $root 'data/calls.txt')) -join ','
  Assert-True ($calls -eq 'backup,stop,run build,run build:server,start:True:True:new,stop,run build,run build:server,start:False:True:old') "Failed startup restores old services: $calls"
  Assert-True (-not (Test-Path (Join-Path $root 'data/zip-update-last-started.sha256'))) 'Failed startup never marks the new version current'

  $root = New-TestProject 'stop-fails'
  Write-File $root 'data/fail-stop.flag' '1'
  Assert-True ((Invoke-Update $root 'normal') -eq 1) 'Failed shutdown reports failure'
  Assert-True ((Get-Content (Join-Path $root 'server/src/index.ts')).Trim() -eq 'old') 'Failed shutdown prevents source replacement'
  Assert-True (((Get-Content (Join-Path $root 'data/calls.txt')) -join ',') -eq 'backup,stop,start:False:True:old') 'Partial shutdown attempts to restore missing services'

  $root = New-TestProject 'pm2'
  Assert-True ((Invoke-Update $root 'pm2') -eq 0) 'PM2 update succeeds'
  $calls = (Get-Content (Join-Path $root 'data/calls.txt')) -join ','
  Assert-True ($calls -eq 'backup,pm2 stop api,pm2 stop web,run build,run build:server,pm2 restart api --update-env,pm2 restart web --update-env,pm2 save') "Named PM2 services restart without extra windows: $calls"
  Write-Host 'All Windows updater tests passed.'
} finally {
  Set-Location $repo
  Remove-Item -LiteralPath $work -Recurse -Force
}
