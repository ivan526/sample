# Shared by the installer and the existing Windows start/stop/update entrypoints.
function Assert-MssAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Windows autostart is managed by SYSTEM. Run this BAT/PowerShell as administrator.'
  }
}

function Get-MssAutoStartTaskNames([string]$RepoPath) {
  $hash = [Security.Cryptography.SHA256]::Create()
  try {
    $canonical = [IO.Path]::GetFullPath($RepoPath).TrimEnd('\','/').ToLowerInvariant()
    $suffix = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical)))).Replace('-', '').Substring(0, 12)
    return @{ api = "MSS-Sample-$suffix-API"; web = "MSS-Sample-$suffix-Web" }
  } finally { $hash.Dispose() }
}

function Get-MssAutoStartConfig([string]$RepoPath) {
  $path = Join-Path $RepoPath 'data/windows-autostart.json'
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $config = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  if ($config.version -ne 1 -or $config.repoPath.TrimEnd('\','/') -ne $RepoPath.TrimEnd('\','/')) {
    throw 'Invalid/moved Windows autostart configuration. Restore the original folder, or remove the old deployment tasks/configuration before reinstalling.'
  }
  $names = Get-MssAutoStartTaskNames $RepoPath
  if ($config.apiTask -ne $names.api -or $config.webTask -ne $names.web) { throw 'Unexpected autostart task names.' }
  return $config
}

function Get-MssServiceTask([string]$RepoPath, [string]$TaskName, [string]$Service) {
  $task = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction Stop
  $runner = Join-Path $RepoPath 'scripts\run-windows-service.ps1'
  $expected = '-File "' + $runner + '" -Service ' + $Service + ' -RepoPath "' + $RepoPath + '" -Background'
  $actions = @($task.Actions)
  if ($actions.Count -ne 1 -or -not $actions[0].Arguments.Contains($expected)) {
    throw "Task $TaskName does not belong to this project/service. Refusing to change it."
  }
  return $task
}
