# SCRAPER PREMIUM

A professional Google Maps business data scraper with a Python/Flask backend, Node.js Playwright scraper engine, and Next.js frontend.

---

## Architecture

```
Frontend (Next.js :3000)
    ↓  REST API
Backend (Python/Flask :5000)
    ↓  HTTP (internal bearer token)
Scraper Engine (Node.js/Playwright :4001)
    ↓  Flat-file JSON
Storage (./storage/)
```

---

## Quick Start

### 1. Configure environment

```powershell
cp .env.example .env
# Edit .env — at minimum set CHROMIUM_EXECUTABLE_PATH
```

### 2. Install Python backend dependencies

```powershell
cd backend
pip install -r requirements.txt
cd ..
```

### 3. Install and start the scraper worker

```powershell
cd scraper-engine
npm install
npx playwright install chromium   # downloads Chromium ~180MB
node src/index.js
```

### 4. Start the backend (new terminal)

```powershell
cd backend
python app.py
```

### 5. Install and start the frontend (new terminal)

```powershell
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | dev-secret | Flask secret key |
| `SCRAPER_STORAGE_DIR` | `./storage` | Persistent storage path |
| `CORS_ORIGINS` | `http://localhost:3000,...` | Allowed origins |
| `CHROMIUM_EXECUTABLE_PATH` | _(playwright bundled)_ | Path to chrome.exe |
| `HEADLESS` | `true` | Run browser headlessly |
| `SCRAPER_WORKER_PORT` | `4001` | Internal worker port |
| `SCRAPER_WORKER_TOKEN` | `dev-token` | Internal bearer token |
| `DEFAULT_DAILY_LIMIT` | `500` | Max records saved per day |
| `DEFAULT_JOB_LIMIT` | `100` | Max records per job |
| `MAX_CONCURRENT_JOBS` | `2` | Parallel scrape jobs |
| `REQUEST_DELAY_MS` | `1500` | Delay between requests |
| `PAGE_LOAD_TIMEOUT_MS` | `30000` | Browser page timeout |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:5000` | Frontend → Backend URL |
| `GROQ_API_KEY` | _(optional)_ | For AI enrichment |

---

## Features

- **New Scrape** — configure search query, category, location, and index range
- **Live Job Monitoring** — real-time progress via Server-Sent Events
- **Results Table** — paginated business table with filtering by city, country, quality score, phone/email/website presence
- **Exports** — download as CSV, Excel (XLSX), or JSON
- **Deduplication** — 5-tier: Place ID → source URL → phone → domain → name+address
- **Quality Scoring** — 0–100 completeness score per business
- **Schedules** — cron-based recurring jobs (config only; a cron runner is needed to trigger them)
- **Backups** — create and restore full data snapshots
- **Settings** — configure defaults from the UI

---

## Running Tests (backend)

```powershell
cd backend
pytest tests/ -v
```
