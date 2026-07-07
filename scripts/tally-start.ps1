# Wrapper run by the "Tally Auto-Start" scheduled task on every logon.
#
# Installed to %LOCALAPPDATA%\Tally\scripts\tally-start.ps1 (NOT inside the git
# checkout) by setup-autostart.ps1, so `git pull` can never overwrite or race
# the script that's invoking it.
#
# Each step below is best-effort: a failed pull or install never prevents
# falling through to build/start against whatever's already on disk, and a
# failed build restores the last-known-good .next rather than leaving the
# employee with nothing running. This script is the task's tracked process —
# it stays in the foreground so Task Scheduler's own "IgnoreNew" single-instance
# policy applies cleanly.

param(
    [string]$RepoPath = "$env:USERPROFILE\tally-app",
    [string]$Branch = "main",
    [int]$Port = 3000
)

$DataDir = "$env:LOCALAPPDATA\Tally"
$LogFile = "$DataDir\autostart.log"

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$env:TALLY_DATA_DIR = $DataDir

function Log($message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
    Add-Content -Path $LogFile -Value $line
}

if (-not (Test-Path $RepoPath)) {
    Log "ERROR: repo not found at $RepoPath — run setup-autostart.ps1 first."
    exit 1
}

Set-Location $RepoPath

Log "Pulling latest ($Branch)..."
git pull --ff-only origin $Branch *>> $LogFile
$pullOk = ($LASTEXITCODE -eq 0)
if (-not $pullOk) { Log "git pull failed (exit $LASTEXITCODE) — continuing with existing checkout." }

$installOk = $false
if ($pullOk) {
    Log "Installing dependencies..."
    npm install --no-audit --no-fund *>> $LogFile
    $installOk = ($LASTEXITCODE -eq 0)
    if (-not $installOk) { Log "npm install failed (exit $LASTEXITCODE) — continuing with existing node_modules." }
} else {
    Log "Skipping npm install (pull failed)."
}

$hadPriorBuild = Test-Path ".next"
if ($installOk -and $hadPriorBuild) {
    Rename-Item ".next" ".next.bak" -Force
}

$buildOk = $false
if ($installOk) {
    Log "Building..."
    npm run build *>> $LogFile
    $buildOk = ($LASTEXITCODE -eq 0)
}

if ($buildOk) {
    if (Test-Path ".next.bak") { Remove-Item ".next.bak" -Recurse -Force }
    Log "Build succeeded."
} elseif (Test-Path ".next.bak") {
    Log "Build failed or skipped — restoring last-known-good build."
    if (Test-Path ".next") { Remove-Item ".next" -Recurse -Force }
    Rename-Item ".next.bak" ".next" -Force
} elseif (-not (Test-Path ".next")) {
    Log "ERROR: build failed and no prior build exists — nothing to run."
    exit 1
}

Log "Starting server on 127.0.0.1:$Port..."
npm start -- -H 127.0.0.1 -p $Port *>> $LogFile
