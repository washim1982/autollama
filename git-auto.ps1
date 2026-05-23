param(
    [string]$Message = "Auto-commit",
    [string]$RemoteUrl = ""
)

Write-Host "`n=== GIT AUTO WORKFLOW STARTED ===`n" -ForegroundColor Cyan

# Ensure Git exists
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git is not installed or not in PATH." -ForegroundColor Red
    exit 1
}

# Check if repo exists
if (-not (Test-Path ".git")) {
    Write-Host "No Git repo found. Initializing..." -ForegroundColor Yellow
    git init
} else {
    Write-Host "Git repo detected." -ForegroundColor Green
}

# Check remote
$remote = git remote -v 2>$null

if ($remote -eq $null -or $remote -notmatch "origin") {
    if ($RemoteUrl -eq "") {
        Write-Host "No remote 'origin' found and no URL provided." -ForegroundColor Red
        Write-Host "Usage: .\git-auto.ps1 -RemoteUrl https://github.com/user/repo.git" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "Adding remote origin..." -ForegroundColor Yellow
    git remote add origin $RemoteUrl
} else {
    Write-Host "Remote origin already exists." -ForegroundColor Green
}

# Stage all files
Write-Host "Adding files..." -ForegroundColor Cyan
git add .

# Commit
Write-Host "Committing..." -ForegroundColor Cyan
git commit -m $Message

# Ensure branch is main
Write-Host "Setting branch to main..." -ForegroundColor Cyan
git branch -M main

# Push
Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
git push -u origin main

Write-Host "`n=== DONE! Your project is synced. ===`n" -ForegroundColor Green
