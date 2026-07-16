# One-time provisioning for an employee machine in the shared/central model.
# Clones the repo, writes this machine's agent config (central URL + the
# person's token issued by an admin), installs the boot wrapper, and registers
# the "Tally Agent" scheduled task that runs at logon. Run once per machine as
# that employee's own Windows user (no admin rights needed).
#
# Get the person token from an admin first: on the central server, add the
# teammate (Settings -> People, or POST /api/people) — the token is shown once.
#
# Usage:
#   .\setup-autostart.ps1 `
#       -RepoUrl    "https://github.com/SheBuildCo/tally-app.git" `
#       -CentralUrl "https://tally.example.com" `
#       -Token      "<the person's agent token>"

param(
    [Parameter(Mandatory = $true)] [string]$RepoUrl,
    [Parameter(Mandatory = $true)] [string]$CentralUrl,
    [Parameter(Mandatory = $true)] [string]$Token,
    [string]$Branch = "main",
    [string]$RepoPath = "$env:USERPROFILE\tally-app"
)

$ErrorActionPreference = "Stop"

function Require-Command($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Error "'$name' was not found on PATH. $hint"
        exit 1
    }
}

Require-Command "git" "Install Git for Windows first: https://git-scm.com/download/win"
Require-Command "node" "Install Node.js 22 LTS first: https://nodejs.org/"
Require-Command "npm" "Node.js install looked incomplete (npm missing) — reinstall Node.js 22 LTS."

if (-not (Test-Path $RepoPath)) {
    Write-Host "Cloning $RepoUrl to $RepoPath..."
    git clone --branch $Branch $RepoUrl $RepoPath
} else {
    Write-Host "Repo already present at $RepoPath — skipping clone."
}

# Write per-machine config OUTSIDE the repo. Holds a secret (the person token),
# so keep it in the user's local profile, not the checkout.
$DataDir = "$env:LOCALAPPDATA\Tally"
$ScriptsDir = "$DataDir\scripts"
New-Item -ItemType Directory -Force -Path $ScriptsDir | Out-Null

$ConfigFile = "$DataDir\agent.config.ps1"
@"
# Tally agent config for this machine. Contains a secret token — do not share.
`$env:TALLY_CENTRAL_URL = "$CentralUrl"
`$env:TALLY_PERSON_TOKEN = "$Token"
"@ | Set-Content -Path $ConfigFile -Encoding UTF8

Copy-Item -Path (Join-Path $PSScriptRoot "tally-start.ps1") -Destination $ScriptsDir -Force
$WrapperPath = Join-Path $ScriptsDir "tally-start.ps1"

Write-Host "Registering scheduled task 'Tally Agent'..."
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WrapperPath`" -RepoPath `"$RepoPath`" -Branch `"$Branch`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Unregister-ScheduledTask -TaskName "Tally Agent" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "Tally Agent" -Action $action -Trigger $trigger -Settings $settings | Out-Null

Write-Host "Done. Firing the task once now to validate (log: $DataDir\agent.log)..."
Start-ScheduledTask -TaskName "Tally Agent"
Write-Host "The agent will push this machine's ActivityWatch to $CentralUrl, now and on every logon."
