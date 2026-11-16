# Start the Node.js scraper engine worker
# Run from project root: .\scripts\start-worker.ps1

$root = Split-Path -Parent $PSScriptRoot
Set-Location "$root\scraper-engine"

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing Node.js dependencies..." -ForegroundColor Yellow
    npm install
    # Install Playwright Chromium browser
    npx playwright install chromium
}

Write-Host "Starting scraper worker on http://127.0.0.1:4001 ..." -ForegroundColor Green
node src/index.js
