# Security, Operations and Local Runbook

## Local development

1. Install a Node.js version supported by Angular 22: Node `22.22.3+` on the 22.x line, `24.15.0+` on the 24.x line, or `26.0.0+`.
2. Install and run MongoDB as a replica set (`rs0` for the example URI). Checkout uses transactions and will not work correctly against a standalone `mongod` that has no replica set configured.
3. Copy `Backend/.env.example` to `Backend/.env`, replace the example JWT secret with a randomly generated secret of at least 32 characters, and keep `.env` private.
4. In `Backend/`, run `npm ci`, `npm run check:syntax`, `npm test`, and then `npm run dev`.
5. In `Frontend/`, run `npm ci`, `npm run build`, and `npm start`. The dev-server proxy forwards `/api` and `/socket.io` to the local backend on port 3000.
6. Register a customer, then promote the intended first administrator through a controlled development database operation. There is deliberately no public admin registration route.

## Included safeguards

- Environment files, installed dependencies, runtime logs, backups and upload contents are excluded by `.gitignore`; only `.env.example` and empty runtime-directory markers are distributed.
- Authentication uses JWT Bearer headers. Logout and password changes increment `tokenVersion`, so previous tokens are rejected on subsequent API requests and Socket.IO connections.
- Server-side authorization is used for administrator and user-specific operations. Frontend route guards are convenience only.
- Login, registration and password-recovery endpoints use rate limiting; local development uses a process-local store while Docker Compose selects a MongoDB-backed shared counter store. Requests beyond configured limits receive HTTP 429 and `Retry-After`.
- API response parsing is size-limited, product image upload type/size is restricted, and product media is served from a dedicated static path without directory listings. The Docker Nginx config adds CSP and related browser security headers, gzip compression and cache rules for hashed assets; review the policy if a future feature requires third-party scripts or embeds.
- Search values are escaped before use in regular expressions. Pagination, sort choices and price filters are validated before querying MongoDB.
- Checkout validates stock inside a transaction, decrements aggregate and selected variant stock atomically, snapshots the selected size/color/SKU and price into the order, and requires an idempotency key. Payment and refund creation also require idempotency keys.
- Variant options are individually active/inactive with integer stock; duplicate size/color combinations are rejected. The product stock is a compatibility aggregate derived from active option stock. Cart and checkout must not trust client-supplied totals or option prices.
- Browser security headers, request logging and centralized error handling are configured in the API.

## Production requirements not solved by source code alone

- Terminate HTTPS/TLS at the production ingress or reverse proxy. Set `ALLOWED_ORIGINS` to the exact frontend origin(s), never a broad wildcard for authenticated APIs.
- The current Angular bearer-token flow stores the JWT in `localStorage`; a successful XSS could read it. The supplied CSP and output handling reduce some XSS exposure but do not make persistent browser storage immune to script compromise. Before putting real customer data online, evaluate migrating to `Secure`, `HttpOnly`, `SameSite` cookies with appropriate CSRF protection, or another reviewed short-lived-token architecture. This was not changed in this patch to avoid silently breaking the existing authentication contract.
- Put Node behind a correctly configured reverse proxy only after explicitly setting and reviewing Express `trust proxy`; otherwise rate-limit client IPs may be interpreted incorrectly. Do not trust arbitrary forwarded headers.
- Local development defaults to in-process rate-limit and cache stores. Docker Compose selects MongoDB-backed shared stores. Test their failure modes, expiry, cache invalidation and semantics under load before relying on multiple replicas in production.
- Use a managed/redundant MongoDB deployment, least-privilege database users, network restrictions, tested automated backups, and a rehearsed restore procedure. Do not expose database restore operations to ordinary storefront requests.
- Restrict `BACKUP_MONGO_URI`/`RESTORE_MONGO_URI` or equivalent operations credentials to an operator environment. If this backend is deployed with those variables, validate the backup target and restore target explicitly.
- Configure request/response monitoring, error alerts, log rotation/retention, dependency auditing, secret rotation, deployment rollback, database indexes and query plans against realistic data.
- For multiple API replicas, use shared cache/rate-limit infrastructure. The supplied Compose profile selects MongoDB-backed shared product-list cache and rate-limit counters; verify this profile under load before considering Redis or a dedicated cache service.
- The development watcher uses Node’s built-in `--watch` mode instead of `nodemon`; that removes the reported nodemon → chokidar → braces development dependency chain. During the latest packaging pass, the npm registry endpoint was unreachable (`EAI_AGAIN registry.npmjs.org`), so a fresh vulnerability result could not be obtained. CI is configured to audit the dependency graph and validate/build the Docker application, but those GitHub jobs have not been run from this environment. See `RELEASE-READINESS.md` for the current status. Do not treat a blocked audit or an unrun workflow as a pass.

## Store behavior and business scope

- Payments are cash-on-delivery/manual only. The store does not capture card or wallet payments.
- Current release behavior: guests may maintain a browser-persisted cart, but new order creation requires authentication and the backend rejects guest checkout. Legacy private-token routes remain only to access/cancel historical guest orders created by earlier versions. Authenticated checkout stores a delivery name, phone and address snapshot. Shipping fees/carrier tracking and online payments are not implemented. Discounts are not implemented; order totals are calculated from server-priced line items.
- Public registration creates customers. Admin provisioning must remain controlled.
- Inventory and order workflows require a MongoDB replica set.
- Product deletion is a soft deactivation; associated records remain in the database. Variant IDs referenced by open orders must be preserved: disable an option and set its stock to zero instead of removing it.
- Virtual try-on generation is rate-limited, authenticated, owner-scoped for status polling, and the provider key is server-side only. It uses a third-party AI provider; only trigger it with user consent, document third-party processing, and keep the generated image transient. The 2D mannequin is a placeholder and generated images do not guarantee fit or size.

## Final local validation checklist

- [ ] `npm run check:syntax` succeeds in `Backend/`.
- [ ] `npm test` completes and results are reviewed in `Backend/`.
- [ ] `npm ci` and `npm run build` succeed in `Frontend/` with a supported Node version.
- [ ] If SSR is required, add Angular SSR in a connected environment, choose route render modes deliberately, and verify both server rendering and client hydration; SSR is not currently included.
- [ ] Health endpoints respond and readiness reports MongoDB as ready.
- [ ] Signup, login, logout/token invalidation, profile updates, password change and password recovery work with a real configured email provider.
- [ ] Product browsing, slug detail, filters, sort, pagination, image upload and soft delete work.
- [ ] Guest and account checkout, guest private-token access/cancellation, cart, wishlist, stock concurrency/idempotency, COD, order status, refunds and reviews are tested.
- [ ] Customer A cannot read or change Customer B's cart, order, payment, refund or notification.
- [ ] Non-admin users cannot call admin endpoints even by bypassing the Angular UI.
- [ ] WebSocket notifications only reach authenticated user/admin rooms.
- [ ] With a valid server-side FASHN API key, a generated preview can be started and retrieved by its owner; without a key the server returns a safe configuration error. Verify provider credit usage and privacy settings.
- [ ] Restore from a backup has been rehearsed on a non-production target.
- [ ] No `.env`, production secret, log, database dump or real upload is staged for GitHub.


## Password recovery and email

Password recovery uses a random one-time token; only its SHA-256 hash is stored and the token expires after 20 minutes. Configure `RESEND_API_KEY`, `MAIL_FROM` and `APP_URL` for production delivery. The API intentionally responds generically so clients cannot determine whether an account exists. In production, missing email configuration must be corrected before promising reset delivery.

## Load test checklist

After the stack is healthy in staging, run `k6 run load-tests/store-smoke.js` with `BASE_URL` set to the staging origin, inspect failure rate, p95 latency, CPU/memory, event-loop latency, MongoDB query latency and connection pool usage, then increase concurrency. This starter script only checks readiness and product listing; it is not proof of order/checkout capacity.
