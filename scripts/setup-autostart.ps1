# One-time provisioning: clone the repo, install the boot wrapper, and
# register the "Tally Auto-Start" scheduled task. Run once per employee
# machine (as that employee's own Windows user, no admin rights required).
#
# Usage (from an interactive PowerShell prompt):
#   .\setup-autostart.ps1 -RepoUrl "https://github.com/SheBuildCo/tally-app.git"

param(
    [Parameter(Mandatory = $true)]
    [string]$RepoUrl,
    [string]$Branch = "main",
    [string]$RepoPath = "$env:USERPROFILE\tally-app",
    [int]$Port = 3000
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

$ScriptsDir = "$env:LOCALAPPDATA\Tally\scripts"
New-Item -ItemType Directory -Force -Path $ScriptsDir | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot "tally-start.ps1") -Destination $ScriptsDir -Force
$WrapperPath = Join-Path $ScriptsDir "tally-start.ps1"

Write-Host "Registering scheduled task 'Tally Auto-Start'..."
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WrapperPath`" -RepoPath `"$RepoPath`" -Branch `"$Branch`" -Port $Port"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Unregister-ScheduledTask -TaskName "Tally Auto-Start" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "Tally Auto-Start" -Action $action -Trigger $trigger -Settings $settings | Out-Null

Write-Host "Done. Firing the task once now to validate setup (check $env:LOCALAPPDATA\Tally\autostart.log)..."
Start-ScheduledTask -TaskName "Tally Auto-Start"
Start-Sleep -Seconds 5
Write-Host "Tally should be starting at http://localhost:$Port — it will also auto-start on every future logon."
