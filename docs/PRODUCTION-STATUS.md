# Production status, runbook and threat model

Evidence-based notes from the 2026-10-29 production review. Nothing here contains secret values.

## Topology

| Part | Host | Notes |
|---|---|---|
| Angular SPA | Vercel (`Frontend/`, build `npm run build`, output `dist/mmarketStore/browser`) | Static only. `vercel.json` rewrites page routes to `index.html` but **not** `/api/*`, `/socket.io/*` or any path with a file extension. |
| Express + Socket.IO API | Render web service (`render.yaml`, root `Backend/`) | Long-lived Node process. Not suitable for Vercel serverless. |
| Database | MongoDB Atlas (or any **replica set**) | Checkout/refunds use transactions: a standalone `mongod` fails with "Transaction numbers are only allowed on a replica set member". |
| Product photos | HTTPS URLs stored in product records; admin uploads on the API's disk | Render's free plan has **no persistent disk**: admin uploads vanish on redeploy/restart. Attach a Render disk (single instance) or move uploads to object storage before relying on them. |

The browser reads its API origin from `Frontend/public/runtime-config.js` (public by design). Changing it needs a new Vercel deployment.

## Verified root cause of the endless "Loading"

* The deployed bundle (`main-L7JUP22K.js`) is byte-identical in name/hash to a fresh build of the current source, so Vercel is serving the latest commit.
* `runtime-config.js` points at `https://mmarket-store-backend.onrender.com/api/v1/`. DNS resolves and TLS connects, but **every request (`/health/live`, `/api/v1/health`, `/api/v1/product`, `/api/v1/category`) received zero bytes** for 60–150 s from both curl and the browser. The API behind that URL is not answering (service suspended/crashed, or stuck waking/booting).
* The old server only called `listen()` *after* MongoDB connected and exited on failure, so a bad `MONGO_URI`, an Atlas network allowlist that excludes Render, or a slow DB meant no open port and no health endpoint, and an unhelpful deploy failure.
* The SPA then showed "Loading…" for 12 s and a developer-facing message ("Make sure the backend and MongoDB are running").

**Not fixable from the repository:** the Render service itself. Open the Render dashboard → service → Events/Logs and check: is it suspended or failing to deploy; is `MONGO_URI` set (it is `sync: false`); does the Atlas Network Access list allow Render (or `0.0.0.0/0` with a strong DB password); is the DB user correct. After this change the logs show `database.connect.failed` with the reason and `/health/live` answers while `/health/ready` returns 503.

Free Render services sleep after inactivity and take up to about a minute to wake; the storefront now waits 30 s, shows "The store is waking up…" after 5 s, and offers a retry.

## Environment variables (names only)

Backend (Render/Docker): `NODE_ENV`, `PORT` (injected by host), `MONGO_URI` (secret), `JWT_SECRET` (secret, ≥32 chars), `JWT_EXPIRES_IN`, `DUMMY_PASSWORD_HASH`, `ALLOWED_ORIGINS` (exact Vercel/custom-domain origins, comma separated), `PUBLIC_SITE_URL`, `APP_URL`, `TRUST_PROXY` (`true` = 1 hop, or a hop count), `PAYMENT_PROVIDER`, `CACHE_STORE`, `SHARED_RATE_LIMIT_STORE` (`mongo` once more than one instance), `MONGO_MAX_POOL_SIZE` (optional, default 20), `RESEND_API_KEY`/`MAIL_FROM`/`RESET_EMAIL_MODE` (optional), `FASHN_API_KEY` (optional, server only).
Frontend: none at build time; `public/runtime-config.js` holds the public API/media/socket origins.

## Threat model (OWASP Top 10 / API Top 10) — checked in this review

| Risk | Result |
|---|---|
| Broken access control (admin routes, other users' orders) | Tested locally: non-admin `GET /order/admin` → 403, user B reading/cancelling user A's order → 404, non-admin status change → 403. |
| Mass assignment | Registering with `"role":"admin"` created a `user`. |
| NoSQL injection | `category[$ne]=x` ignored; login with operator objects → 400; regex input is escaped; sort keys allowlisted. |
| Resource abuse | `pageSize` > limit → 400; login limited to 5 attempts/window (429 + `Retry-After`). In-memory limiter is per-process: set `SHARED_RATE_LIMIT_STORE=mongo` for multiple instances. Behind Cloudflare/Render, confirm `TRUST_PROXY` hop count so `req.ip` is the real client. |
| Uploads | 2 MiB, PNG/JPEG only, magic-byte check, UUID names, admin only. Files live on local disk (see above). |
| CORS | Strict allowlist, no credentials; verified an unknown origin gets 403 and no ACAO header. |
| Transport/headers | HSTS added in production; SPA now ships a CSP (`script-src 'self'`, `connect-src` limited to the API origin). If the API origin changes, update `Frontend/vercel.json` CSP too. |
| Dependencies | `npm audit --omit=dev`: backend 0, frontend 0 after `npm audit fix` (no `--force`). One high finding remains in the Angular build tool's dev server (Vite) — dev-only, not shipped; revisit on the next `@angular/build` patch. |
| Realtime | Socket.IO handshake requires a valid JWT and active user; users join only their own room; `admins` room by role. |

Residual risks: no CAPTCHA; JWT in browser storage (XSS would expose it — mitigated by the CSP and sanitised output); single-instance Socket.IO (add the Redis adapter and sticky sessions before scaling out); no automated off-site DB backup unless Atlas backups are enabled (see `Backend/docs/database-backup.md`).

## Capacity (measured locally, not production)

`node load-tests/node-load.mjs <base> <path> [concurrency] [seconds]` refuses hosted URLs unless `ALLOW_REMOTE_LOAD=1`. Measured on one developer laptop with the API, an in-memory single-node MongoDB replica set, and the load generator all on the same machine, 110 seeded products:

| Endpoint | Concurrency | Req/s | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|---|
| `GET /api/v1/product?page=1&pageSize=12` | 10 | 419 | 22.8 ms | 29.8 ms | 40.2 ms | 0 |
| same | 50 | 398 | 123.8 ms | 147.3 ms | 156 ms | 0 |
| `GET /api/v1/health` | 50 | 1043 | 45 ms | 63.7 ms | 89.2 ms | 0 |

Throughput plateaus near 400 req/s for the catalogue on one Node process (latency grows linearly with concurrency, i.e. CPU-bound). Per-request JSON logging to disk is the first suspect for the `/health` ceiling. These figures say nothing about Render/Atlas hardware or the network; re-measure on a staging deployment. Scale path: vertical first, then several stateless API instances with `SHARED_RATE_LIMIT_STORE=mongo`, `CACHE_STORE=mongo`, shared upload storage and a Socket.IO Redis adapter.

## Monitoring

Alert on: `/health/ready` ≠ 200, HTTP 5xx rate, p95 latency, Atlas connection count/CPU, process memory restarts, and `database.connect.failed` / `security.rate_limit_store.failed` log events.
