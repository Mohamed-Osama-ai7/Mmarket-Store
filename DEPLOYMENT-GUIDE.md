# Mmarket Final Release Guide

## Current architecture
- Angular 22 storefront (`Frontend/`)
- Express 5 API + Socket.IO (`Backend/`)
- MongoDB replica set (Docker Compose for local development)
- Cash on Delivery only; no online card/wallet integration or shipping fee calculation

## Local Windows / Docker
1. Install Docker Desktop and confirm virtualization/WSL are working.
2. In the project root, copy `.env.example` to `.env` and generate a strong unique `JWT_SECRET`. Never commit `.env`.
3. Check free disk space, then run:
   - `docker compose config --quiet`
   - `docker compose up --build -d`
   - `docker compose ps -a`
   - `docker compose logs --tail 100 mongo-init backend catalog-seed frontend`
4. Open `http://localhost:8080`. The catalog seed is idempotent and does not drop existing records.
5. Verify `http://localhost:8080/healthz` and `http://localhost:8080/api/v1/health`.

Never run `docker compose down -v` unless you explicitly want to delete the named-volume database. Back up the database before any migration.

## Recommended first deployment
**Recommended starting topology: Vercel (Angular) + Railway (Express/Socket.IO) + MongoDB Atlas.** Vercel Functions now support WebSocket connections, but Vercel notes future connections are not guaranteed to reconnect to the same Function; this app already uses an Express Socket.IO server with authenticated user rooms, so a persistent Railway Node service is the simpler starting point. Railway has an official Express/Socket.IO deployment guide. Compare current plan prices and limits before selecting a paid plan. Sources: https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections and https://docs.railway.com/guides/socketio.

### Vercel frontend
- Set the Vercel project Root Directory to `Frontend`.
- Use `npm ci` and `npm run build`; the configured output is `dist/mmarketStore/browser`.
- Configure `Frontend/public/runtime-config.js` with the public Railway API origin, for example:
  `apiURL: 'https://YOUR-RAILWAY-API-DOMAIN/api/v1/'`
  `mediaURL: 'https://YOUR-RAILWAY-API-DOMAIN/api/v1/media/products/'`
  `socketURL: 'https://YOUR-RAILWAY-API-DOMAIN'`
  `socketPath: '/socket.io'`
- `runtime-config.js` is public. Never place secrets in it.
- The Railway API must allow the exact deployed Vercel origin in `ALLOWED_ORIGINS`.

### Railway backend
- Deploy `Backend/` as a Node service using `npm ci --omit=dev` and `npm start`.
- Set the service's root directory to `Backend`.
- Configure a MongoDB Atlas connection string as `MONGO_URI` using a dedicated database user with least-privilege access. Atlas must support transactions/replica-set semantics because checkout reserves stock in a transaction.
- Set a strong `JWT_SECRET`, `JWT_EXPIRES_IN`, `DUMMY_PASSWORD_HASH`, `ALLOWED_ORIGINS` (exact Vercel origin), `PUBLIC_SITE_URL`, `APP_URL`, `PAYMENT_PROVIDER=manual`, and suitable persistent/managed options for uploads/logging if those functions are used.
- Confirm `/health/live`, `/health/ready`, and `/api/v1/health`.
- Confirm a real authenticated Socket.IO event from the deployed browser.

### Database / sample data
- Use MongoDB Atlas for production, separate from the local Docker volume.
- Run `node scripts/seed-catalog.js` only against the intended development/demo database; its upserts preserve existing data but will create the demo catalogue. Review product prices and image rights before real commercial sales.
- Keep a separate, least-privilege production DB user; never publish database credentials.

## Critical behavior in this archive
- Guests may keep a local cart and manage it before login.
- New order creation requires authentication on the backend. The old guest-checkout endpoint responds `401`; legacy private-token guest-order routes only exist to maintain access to historical orders from older versions.
- On login, a guest cart is merged into the user's persisted cart through an authenticated, transaction-based, idempotent endpoint.
- New customer orders require name, phone and address; delivery details are saved as an order snapshot. Shipping fees and tracking remain out of scope.
- The profile page displays persisted profile fields and statistics derived from that customer's own saved orders.

## Verification checklist
Run on a development machine with network access and current supported tooling:
- `npm ci` in `Backend/`, then `npm run check:syntax` and `npm run test:unit`.
- `npm ci` in `Frontend/`, then `npm test` and `npm run build`.
- `docker compose config --quiet`, then actual container build/start and health checks.
- E2E: guest add-to-cart succeeds; guest direct order POST returns 401; signup persists across restart; login merges guest cart exactly once; customer checkout persists delivery details/order; profile order stats reflect persisted orders; second customer cannot access first customer's profile/orders; Socket.IO event is received.

Do not treat this archive as production-certified until the runtime checks above pass in the target environment.


## SEO files on Vercel

`Frontend/public/robots.txt` is served as a static file. The product sitemap is generated by the backend, so after the Railway domain is known add these rewrites **before** the catch-all rule in `Frontend/vercel.json`, and add `Sitemap: https://YOUR-VERCEL-DOMAIN/sitemap.xml` to `robots.txt`:

```json
{ "source": "/sitemap.xml", "destination": "https://YOUR-RAILWAY-API-DOMAIN/sitemap.xml" }
```

Set `PUBLIC_SITE_URL` on Railway to the public Vercel origin so every `<loc>` in the sitemap uses the real storefront URL. In production the backend now refuses to start if `JWT_SECRET`, `JWT_EXPIRES_IN`, `DUMMY_PASSWORD_HASH`, `MONGO_URI` or `ALLOWED_ORIGINS` are missing, or if the JWT secret is shorter than 32 characters or still the example placeholder.
