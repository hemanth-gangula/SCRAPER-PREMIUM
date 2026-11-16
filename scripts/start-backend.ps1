# Start the Python Flask backend
# Run from project root: .\scripts\start-backend.ps1

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path "$root\.env")) {
    Write-Host "No .env found — copying from .env.example" -ForegroundColor Yellow
    Copy-Item "$root\.env.example" "$root\.env"
}

Set-Location "$root\backend"
Write-Host "Starting Flask backend on http://localhost:5000 ..." -ForegroundColor Green

# Prefer gunicorn in production, fall back to flask dev server
if (Get-Command gunicorn -ErrorAction SilentlyContinue) {
    gunicorn -w 2 -b 0.0.0.0:5000 "app:create_app()"
} else {
    python app.py
}
