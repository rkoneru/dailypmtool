# Project Planner

Offline-first project planning tool: a planner sheet, a live status dashboard, and a
Gantt/workflow board, backed by a small Node server for auth, sync, and Excel
import/export. Installable as a PWA and works fully offline after first load.

## Features

- Planner page — objective, due date, milestones, simple task list
- Dashboard page — status, budget, pending items, assigned tasks
- Gantt page — kanban-style workflow board plus a detailed timeline/Gantt chart
  with dependency arrows, calendar-aligned ruler, and inline editing
- Token-based auth with conflict-safe sync (optimistic version checks, with a
  force-overwrite escape hatch)
- Excel (`.xlsx`) import/export matching the on-screen planner/dashboard fields,
  with field-level validation on import
- Three API modes — Auto (real backend, falls back to mock if unreachable),
  Real, and Mock (fully local, browser-storage only)
- PWA with offline support (service worker precaches the app shell)
- PDF (print), PNG, and CSV export

## Project structure

```
dailytracker/
├── index.html           Single-page app shell
├── server.js             Node HTTP server: auth, planner store, Excel import/export
├── css/styles.css
├── js/
│   ├── app.js             Page routing, top-level wiring
│   ├── state.js           State load/save, debounced autosave, dot-path helpers
│   ├── apiClient.js        Real/mock API client, auth token handling
│   ├── planner.js          Planner page rendering + editing
│   ├── dashboard.js        Dashboard page rendering + editing
│   ├── gantt.js            Workflow board + Gantt timeline
│   ├── charts.js           Dashboard chart rendering
│   ├── export.js           PDF/PNG/CSV export
│   └── sampleData.js       Default/sample planner state
├── data/planner-store.json Server-side JSON store (created on first run)
├── sw.js                  Service worker (offline cache)
├── manifest.json          PWA manifest
└── vendor/html2canvas.min.js
```

## Local run

The server requires `AUTH_PASSWORD` and `TOKEN_SECRET` to be set — it refuses to
start without them (there are no built-in insecure defaults).

```bash
npm install
AUTH_PASSWORD=strong-password TOKEN_SECRET=super-long-random-secret npm start
```

Open `http://localhost:3000`.

On Windows PowerShell:

```powershell
$env:AUTH_USER="planner-admin"
$env:AUTH_PASSWORD="strong-password"
$env:TOKEN_SECRET="super-long-random-secret"
npm start
```

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `AUTH_USER` | no | `admin` | Login username |
| `AUTH_PASSWORD` | **yes** | — | Login password |
| `TOKEN_SECRET` | **yes** | — | HMAC secret for signing auth tokens |
| `TOKEN_TTL_SECONDS` | no | `28800` (8h) | Token lifetime |
| `PORT` | no | `3000` | HTTP port |

## Using the app without a server

Open `index.html` directly (`file://`) or set the API mode to **Mock** in
**Export & Share → Backend Connectivity**. Mock mode simulates auth and
planner load/save (with conflict checks) entirely in browser storage. Excel
import/export and the real multi-device sync still require the Node backend.

## API

Public:

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/planner/template.xlsx`

Protected (`Authorization: Bearer <token>`):

- `GET /api/planner`
- `POST /api/planner` — body includes `expectedVersion` and optional `force`
- `GET /api/planner/export.xlsx`
- `POST /api/planner/import.xlsx` — JSON body with a base64-encoded workbook

### Conflict strategy

Saves and imports carry `expectedVersion`. If it doesn't match the server's
current version, the server responds `409 VERSION_CONFLICT` with its current
state; the UI then offers to overwrite (`force: true`) or reload the server's
copy before retrying.

## Excel import/export

Workbook sheets:

| Sheet | Purpose |
|---|---|
| `planner_view` / `dashboard_view` | Human-readable, website-matching layout |
| `template_notes` | Usage notes embedded in the workbook |
| `planner_fields` | `projectName`, `objective`, `dueDate`, `reward`, `notes` |
| `dashboard_fields` | `dashDate`, `dashStatus`, `dashSummary`, budget, pending fields |
| `milestones`, `tasks`, `dashboard_tasks`, `timeline` | Row-level data |
| `summary` | Legacy single-row compatibility sheet |

Download a blank starter workbook from the UI (**Download Excel Template**) or
via the public `GET /api/planner/template.xlsx` endpoint.

Import validates before applying any changes and rejects workbooks with:

- missing required sheets or columns
- dates not in `YYYY-MM-DD` format
- invalid status/priority values
- invalid boolean or numeric values
- invalid timeline marker/day values

The UI surfaces field-level validation errors so the workbook can be fixed and
re-imported.

## Deployment

### Render

Use [render.yaml](./render.yaml); set `AUTH_PASSWORD` / `TOKEN_SECRET` as
secret env vars in the Render dashboard.

### Fly.io

```bash
fly launch
fly deploy
```

Uses [fly.toml](./fly.toml); set secrets with `fly secrets set`.

### Vercel

Uses [vercel.json](./vercel.json) for Node runtime routing.

> Serverless deployments (Vercel) have ephemeral filesystems — `data/planner-store.json`
> will not persist across deployments or cold starts. For durable storage on
> Vercel, back the planner store with mounted or external storage instead.

## Security notes

- Auth uses timing-safe comparisons and HMAC-signed tokens; there is no
  built-in rate limiting beyond the login endpoint's per-IP throttle.
- Static file serving and the planner store are confined to the app root via
  path resolution checks.
- Set a long, random `TOKEN_SECRET` in any environment reachable over a
  network — a predictable secret lets anyone forge valid auth tokens.
