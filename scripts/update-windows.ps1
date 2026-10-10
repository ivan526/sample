# Windows deployment updater for MSS sample stocking platform.
# Examples:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-windows.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-windows.ps1 -Pm2Names "mss-api,mss-web"
param(
    [string]$RepoPath = (Split-Path -Parent $PSScriptRoot),
    [string]$Pm2Names = "",
    [switch]$RunTests,
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program $($Arguments -join ' ') failed (exit $LASTEXITCODE)"
    }
}

function Get-GitHash {
    $hash = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Unable to read current commit" }
    return $hash
}

try {
    $RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path
    Set-Location -LiteralPath $RepoPath
    if (-not (Test-Path ".git") -or -not (Test-Path "package.json")) {
        throw "Not a Git checkout of the application: $RepoPath"
    }
    foreach ($command in @("git", "node", "npm")) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw "Required program not found in PATH: $command"
        }
    }

    $branch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -ne "main") {
        throw "Switch to the main branch before updating (current: $branch)"
    }
    $dirty = @(& git status --porcelain --untracked-files=no)
    if ($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0) {
        throw "Tracked files have local modifications; resolve them before automatic updates."
    }
    $oldHash = Get-GitHash
    Write-Host "Current commit: $oldHash"
    Invoke-Checked "git" @("fetch", "--prune", "origin", "main")
    $remoteHash = (& git rev-parse "origin/main").Trim()
    if ($LASTEXITCODE -ne 0) { throw "Unable to read origin/main" }
    $common = (& git merge-base HEAD "origin/main").Trim()
    if ($LASTEXITCODE -ne 0 -or $common -ne $oldHash) {
        throw "Local main has diverged from origin/main; no automatic reset performed."
    }
    if ($remoteHash -eq $oldHash) {
        Write-Host "Already up to date. No changes made."
        exit 0
    }
    Write-Host "New commit available: $remoteHash"
    if ($CheckOnly) { exit 0 }

    # Back up the active SQLite DB using its online backup API.
    # Respect SQLITE_PATH in .env; never copy only a live WAL-mode .db file.
    if (-not (Test-Path "node_modules/better-sqlite3")) {
        throw "Dependencies missing: run npm install once before the first automated update (required for safe SQLite backup)."
    }
    $backupCode = @'
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(process.cwd(), ".env"), quiet: true });
if ((process.env.DATABASE_URL || "").startsWith("postgresql://")) {
  console.error("PostgreSQL detected: this updater requires a separate PG backup plan.");
  process.exit(2);
}
const source = path.resolve(process.env.SQLITE_PATH || path.join(process.cwd(), "data", "mss_dev.db"));
if (!fs.existsSync(source)) {
  console.error("SQLite database not found: " + source + ". Refusing to update.");
  process.exit(2);
}
const Database = require("better-sqlite3");
const backups = path.join(path.dirname(source), "backups");
fs.mkdirSync(backups, { recursive: true });
const target = path.join(backups, "mss-before-update-" + new Date().toISOString().replace(/[:.]/g, "-") + ".db");
const db = new Database(source, { readonly: true, fileMustExist: true });
db.backup(target).then(() => {
  db.close();
  const test = new Database(target, { readonly: true });
  const integrity = test.pragma("integrity_check");
  test.close();
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
    console.error("Backup integrity check failed: " + target);
    process.exitCode = 2;
  } else {
    console.log("SQLite backup verified: " + target);
  }
}).catch(error => { db.close(); console.error(error); process.exitCode = 2; });
'@
    & node -e $backupCode
    if ($LASTEXITCODE -ne 0) { throw "Database backup failed. Update aborted." }

    $updated = $false
    try {
        Invoke-Checked "git" @("merge", "--ff-only", "origin/main")
        $updated = $true
        Invoke-Checked "npm" @("install", "--no-audit", "--no-fund")
        Invoke-Checked "npm" @("run", "build")
        Invoke-Checked "npm" @("run", "build:server")
        if ($RunTests) { Invoke-Checked "npm" @("test") }
    } catch {
        $reason = $_
        if ($updated) {
            Write-Warning "Update/build failed; restoring tracked files to original commit $oldHash."
            Invoke-Checked "git" @("reset", "--hard", $oldHash)
            # Best effort restoration of dependencies and build artifacts.
            try {
                Invoke-Checked "npm" @("install", "--no-audit", "--no-fund")
                Invoke-Checked "npm" @("run", "build")
                Invoke-Checked "npm" @("run", "build:server")
            } catch {
                Write-Warning "Rollback build failed. Check server before restarting: $_"
            }
        }
        throw $reason
    }

    # Service restart is explicit: never terminate every node.exe on the server.
    $names = @($Pm2Names.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($names.Count -gt 0) {
        if (-not (Get-Command "pm2" -ErrorAction SilentlyContinue)) {
            throw "Code updated, but pm2 is not installed. Restart the configured service manually."
        }
        foreach ($name in $names) {
            Invoke-Checked "pm2" @("restart", $name, "--update-env")
        }
        Invoke-Checked "pm2" @("save")
        Write-Host "Update complete and configured PM2 processes restarted."
    } else {
        Write-Warning "Code and builds updated, but running API/web services were NOT restarted. Restart your actual service manager to activate this release."
    }
    Write-Host "Deployed commit: $(Get-GitHash)"
    exit 0
} catch {
    Write-Error "Automatic update stopped: $_"
    exit 1
}
