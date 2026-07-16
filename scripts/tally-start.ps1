# Wrapper run by the "Tally Agent" scheduled task on every logon.
#
# In the shared/central model an employee machine runs ONLY the push agent —
# no local server, no build, no database. This script keeps the checkout fresh
# and runs the agent, which reads local ActivityWatch and pushes to the central
# Tally server. Installed to %LOCALAPPDATA%\Tally\scripts\ (outside the git
# checkout) by setup-autostart.ps1, so `git pull` can never clobber it.
#
# Per-machine config (central URL + this person's token) is written by
# setup-autostart.ps1 to %LOCALAPPDATA%\Tally\agent.config.ps1 and sourced here.
# Each step is best-effort: a failed pull or install still falls through to
# running the agent with whatever is already on disk.

param(
    [string]$RepoPath = "$env:USERPROFILE\tally-app",
    [string]$Branch = "main"
)

$DataDir = "$env:LOCALAPPDATA\Tally"
$LogFile = "$DataDir\agent.log"
$ConfigFile = "$DataDir\agent.config.ps1"

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

function Log($message) {
    "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message |
        Add-Content -Path $LogFile
}

if (-not (Test-Path $RepoPath)) {
    Log "ERROR: repo not found at $RepoPath — run setup-autostart.ps1 first."
    exit 1
}
if (Test-Path $ConfigFile) {
    . $ConfigFile   # sets $env:TALLY_CENTRAL_URL and $env:TALLY_PERSON_TOKEN
} else {
    Log "ERROR: $ConfigFile missing — run setup-autostart.ps1 to configure this machine."
    exit 1
}

Set-Location $RepoPath

Log "Pulling latest ($Branch)..."
git pull --ff-only origin $Branch *>> $LogFile
if ($LASTEXITCODE -ne 0) { Log "git pull failed — continuing with existing checkout." }

Log "Installing dependencies..."
npm ci *>> $LogFile
if ($LASTEXITCODE -ne 0) { Log "npm ci failed — continuing with existing node_modules." }

Log "Starting Tally agent -> $env:TALLY_CENTRAL_URL"
npm run agent *>> $LogFile
