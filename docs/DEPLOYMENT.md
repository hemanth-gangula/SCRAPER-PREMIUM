# Deployment Guide — Scraper Premium

## Architecture on Production

```
Vercel (free)               Render (starter ~$7/mo each)
───────────────             ────────────────────────────────────────────
Next.js Frontend  ──REST──► Flask API  (Web Service)
                            Flask API  ──internal──► Node Worker (Background Worker)
                            Both services share a Render Persistent Disk (/data/storage)
```

---

## Part 1 — Deploy Backend to Render

### Prerequisites
- GitHub account with this repo pushed to it
- Render account at https://render.com (free tier works for testing)

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USER/scraper-premium.git
git push -u origin main
```

### Step 2 — Create services via Blueprint (recommended)
1. Go to https://dashboard.render.com
2. Click **New → Blueprint**
3. Connect your GitHub repo
4. Render reads `render.yaml` and creates both services automatically

### Step 3 — Set secret environment variables in Render dashboard
For **scraper-premium-backend**:
| Variable | Value |
|---|---|
| `SECRET_KEY` | Any 40+ char random string |
| `ADMIN_PASSWORD` | Your chosen dashboard password |
| `SCRAPER_WORKER_TOKEN` | Any 40+ char random string (must match worker) |
| `CORS_ORIGINS` | `https://your-app.vercel.app` (set after Vercel deploy) |

For **scraper-premium-worker**:
| Variable | Value |
|---|---|
| `SCRAPER_WORKER_TOKEN` | Same value as backend |

### Step 4 — Note your backend URL
After deploy, Render gives you a URL like:
```
https://scraper-premium-backend.onrender.com
```
Save this — you'll need it for Vercel.

---

## Part 2 — Deploy Frontend to Vercel

### Step 1 — Import project
1. Go to https://vercel.com/new
2. Import your GitHub repo
3. Set **Root Directory** to `frontend`
4. Framework: **Next.js** (auto-detected)

### Step 2 — Set environment variable
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://scraper-premium-backend.onrender.com` |

### Step 3 — Deploy
Click **Deploy**. Vercel builds and deploys in ~2 minutes.

Your app is now live at `https://your-app.vercel.app`

### Step 4 — Update CORS on Render
Go back to Render → Backend service → Environment → Update `CORS_ORIGINS`:
```
https://your-app.vercel.app
```
Render redeploys automatically.

---

## Part 3 — Manual Render Setup (without Blueprint)

If you prefer to set up manually instead of using `render.yaml`:

### Backend (Web Service)
| Setting | Value |
|---|---|
| **Runtime** | Python 3 |
| **Root Directory** | `backend` |
| **Build Command** | `pip install -r requirements.txt && bash build.sh` |
| **Start Command** | `gunicorn -w 2 --timeout 120 -b 0.0.0.0:$PORT "app:create_app()"` |
| **Health Check Path** | `/api/health` |

### Persistent Disk
| Setting | Value |
|---|---|
| **Name** | `scraper-data` |
| **Mount Path** | `/data` |
| **Size** | 10 GB |

### Worker (Background Worker)
| Setting | Value |
|---|---|
| **Runtime** | Node |
| **Root Directory** | `scraper-engine` |
| **Build Command** | `npm install && npx playwright install chromium --with-deps` |
| **Start Command** | `node src/index.js` |

> **Note:** The scraper worker and backend cannot directly share a disk on Render's free/starter plan — they are separate instances. For production, use the **Standard plan** which allows disk sharing, or store data in a remote database instead of JSON files. For personal/small-scale use the starter plan works fine — jobs still run, results are stored on the worker's ephemeral disk during a session.

---

## Important Notes

### Storage on Render
Render's free/starter Web Services have **ephemeral storage** — files are wiped on redeploy. The persistent disk (`/data`) is mounted only on the backend. For the scraper worker (Background Worker), results are written to the backend via the API.

**For a fully persistent setup:**
- Use Render Standard plan with disk sharing
- Or switch storage from JSON files to a hosted database (PostgreSQL on Render, MongoDB Atlas, etc.)

### Scraper Worker on Render
Playwright requires Chromium to be installed. The build command `npx playwright install chromium --with-deps` handles this but adds ~400MB to the build. This works on Render's starter plan.

### Cold Starts
Render's free tier spins down after 15 min of inactivity. Use **Starter** ($7/mo) to avoid cold starts. The frontend on Vercel is always instant.

### Custom Domain
- Vercel: Add domain in Project Settings → Domains
- Render: Add domain in Service Settings → Custom Domains

---

## Environment Variables Summary

### Backend (Render)
```
SECRET_KEY=<generate-40-chars>
FLASK_ENV=production
FLASK_DEBUG=false
SCRAPER_STORAGE_DIR=/data/storage
CORS_ORIGINS=https://your-app.vercel.app
ADMIN_PASSWORD=<your-password>
SCRAPER_WORKER_PORT=4001
SCRAPER_WORKER_TOKEN=<generate-40-chars>
DEFAULT_DAILY_LIMIT=500
DEFAULT_JOB_LIMIT=100
MAX_CONCURRENT_JOBS=2
REQUEST_DELAY_MS=2000
PAGE_LOAD_TIMEOUT_MS=30000
GROQ_API_KEY=<optional>
```

### Worker (Render)
```
SCRAPER_WORKER_PORT=4001
SCRAPER_WORKER_TOKEN=<same-as-backend>
HEADLESS=true
REQUEST_DELAY_MS=2000
PAGE_LOAD_TIMEOUT_MS=30000
MAX_CONCURRENT_JOBS=2
SCRAPER_STORAGE_DIR=/data/storage
```

### Frontend (Vercel)
```
NEXT_PUBLIC_API_BASE_URL=https://scraper-premium-backend.onrender.com
```
