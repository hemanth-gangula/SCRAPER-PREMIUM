# Start the Next.js frontend dev server
# Run from project root: .\scripts\start-frontend.ps1

$root = Split-Path -Parent $PSScriptRoot
Set-Location "$root\frontend"

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    npm install
}

Write-Host "Starting Next.js frontend on http://localhost:3000 ..." -ForegroundColor Green
npm run dev
