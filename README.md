# Mmarket Store — Full-stack Fashion E-commerce

A full-stack storefront for the MEAN Level 2 course. The implementation follows the approachable Angular component/service style in the supplied teaching project and organizes the Express/Mongoose backend in the layer-first MVC style of `myStoreAPI`, while retaining Mmarket’s existing store features, schemas, API contracts, and business rules. It is organized as one repository with two clear application folders.

## Project structure

```text
mmarket-store/
├── Frontend/
│   └── src/app/
│       ├── core/       # Models, API services, guards, interceptors and resolver
│       ├── layout/     # Store pages; each component has its own .ts/.html/.css
│       ├── dashboard/ # Admin pages; each component has its own .ts/.html/.css
│       └── shared/     # Shared header/footer, not-found page, directives and pipes
├── Backend/
│   ├── config/         # MongoDB/runtime configuration
│   ├── middlewares/    # Authentication, roles, validation/security support and logging
│   ├── controller/, model/, route/, service/  # MVC layers in the reference project style
│   ├── utilities/      # Logger, cache and Socket.IO notification helpers
│   ├── tests/          # Meaningful unit and integration tests
│   ├── scripts/        # Backend syntax checker
│   ├── uploads/        # Local product images (ignored by Git except .gitkeep)
│   ├── logs/           # Runtime logs (ignored by Git except .gitkeep)
│   └── backups/        # Local backup files (ignored by Git except .gitkeep)
├── DEPLOYMENT-GUIDE.md
├── SECURITY-AND-RUNBOOK.md
└── RELEASE-READINESS.md
```

The Compose project name remains `ecommerce` intentionally, preserving existing named-volume names for anyone upgrading an earlier archive; the delivered folder and package names are Mmarket-branded. Files such as `node_modules`, Angular caches/build output, local `.env`, runtime logs, backup dumps and uploaded customer/product data are deliberately not included. Useful backend tests are retained because unit testing is explicitly part of the course.

## Angular structure aligned with the supplied `myStore` example

The Angular application keeps the same teachable component layout: each screen is grouped by feature and has a dedicated TypeScript class, external HTML template, and CSS file (`component.ts`, `component.html`, `component.css`). `layout/` contains customer-facing screens, `dashboard/` contains administrative screens, `core/models/` defines API/domain types, `core/services/` owns HTTP and application state, and `shared/` holds reusable UI parts. Standalone components declare their template dependencies explicitly and use Angular Router for navigation.

The supplied examples contain a few non-standard identifiers/imports (including a `Service` decorator that Angular does not provide); this project follows their readable separation without copying those errors or replacing Mmarket’s real commerce implementation. Existing route guards, resolvers, HTTP interceptors, typed models, lazy-loaded routes, and server-side authorization are retained because they protect the store and reduce initial page loading.

## Store capabilities

- Product catalogue and slug-based detail URLs (`/products/:slug`).
- Server-side product search, category filter, minimum/maximum price filters, sort order and bounded pagination.
- Admin product create/update and soft deactivation, product image upload, category management, order fulfilment, COD confirmation, refund review and reports.
- Customer registration/login/logout, persistent profile details, password changes with token revocation, guest and authenticated carts, authenticated-only checkout, account purchase statistics, order history, reviews and refund requests.
- JWT Bearer authentication, backend role checks, protected Angular routes, HTTP interceptors and a product resolver.
- RxJS/BehaviorSubject state for authentication, cart and notifications. REST handles notification history/read state; authenticated Socket.IO provides live updates when available. Successful login shows a global, accessible “Welcome back, <name>!” toast using the authenticated profile name.
- Bootstrap 5, a working light/dark theme, component-scoped HTML/CSS files, loading/error/empty states, accessible form labels, lazy-loaded images, product metadata, JSON-LD product data, `robots.txt` and a generated product sitemap. The font stack does not depend on Google Fonts at build time, keeping the build offline-friendly and consistent with the supplied Content Security Policy.
- Password recovery with one-time hashed tokens and 20-minute expiry; configure Resend for real production email delivery. Local development can preview reset emails in the backend console.
- Public contact form and an admin inbox; customer/order/payment/refund events are stored as notifications, with authenticated Socket.IO updates and email order updates when mail is configured.
- An optional product-to-model fitting room with male/female model choice and several catalogue styles. A stylized placeholder works locally; realistic AI generation requires `FASHN_API_KEY` on the server and provider credits, and is triggered explicitly to control cost.
- Product SKU and up to five images per product; uploads are restricted to PNG/JPEG signatures and a 2 MiB maximum per image. Optional SKU-level size/color variants support per-option SKU, price override, active status and stock. The checkout reserves the selected option atomically while keeping `product.stock` as a backwards-compatible aggregate. The admin editor preserves existing option IDs; existing options referenced by open orders should be disabled with zero stock rather than deleted.

## Site-content CMS

The admin sidebar includes **Site content** at `/dashboard/content`. Authorized administrators can manage store branding and SEO defaults, the announcement bar, header navigation, footer description/link groups/social links, homepage copy and visibility switches, additional homepage sections, and plain-text content pages. Content pages use draft/published/archived states; archiving is reversible. The backend validates content and protects write routes with the same authentication/role middleware used by the other admin features.

Public CMS endpoints are mounted under `/api/v1/site-content`. Public clients receive published pages and safe content fields; draft and archived page bodies remain admin-only. New public pages render at `/pages/:slug`. The body field intentionally uses plain text rather than arbitrary HTML. Review `ARCHITECTURE.md` for the component/service/API/database flow and the mapping to the supplied `myStore` instructor style.

**Release limitation:** this source package is a release candidate, not a production-certified final. It does not include true Angular SSR/hydration; the current Vercel configuration is SPA hosting. See `RELEASE-REPORT.md` for the latest artifact-specific test evidence and `RELEASE-READINESS.md` for additional release gates.

## First-run product catalogue and infinite-loading troubleshooting

The storefront reads product records from the local MongoDB database through the local Express API. It does **not** load product records from an external shop API. On a first Docker startup, the `catalog-seed` service idempotently adds the 110-product demo clothing and accessories catalogue plus its categories before the frontend starts. Product descriptions, prices, categories, SKUs, size/color options, and stock are database records. Demo product photography is currently stored as HTTPS Unsplash image URLs in those records, so the photos require internet access; the product records themselves remain in MongoDB.

If the storefront stays on the catalogue loader, start the whole Compose stack and check the API/data seed before debugging the UI:

```powershell
docker compose ps -a
docker compose logs --tail 120 backend catalog-seed frontend
Invoke-RestMethod 'http://localhost:8080/api/v1/product?page=1&pageSize=8'
```

A healthy API returns JSON with a `data` array. The home page times out an unresponsive catalogue request after 12 seconds and shows an error with a retry action instead of waiting forever. Angular 22 defaults to zoneless change detection, while several existing screens use mutable fields in asynchronous callbacks; this package explicitly configures Zone-based scheduling for compatibility and marks critical catalogue/admin views for checking. A timeout usually means Docker/backend/database connectivity or startup-seed trouble; it should not be fixed by adding hard-coded products to Angular.

When developing without Docker, start MongoDB as a replica set, set `Backend/.env`, then run `npm ci`, `npm run seed:catalog`, and `npm run dev` from `Backend/`. The seed is idempotent and adds missing demo catalogue entries without deleting existing products.

## Quick start with Docker Compose

From the repository root, create the local environment file and set a unique JWT secret:

```powershell
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Paste the generated value into `JWT_SECRET` in `.env`, then run:

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f backend catalog-seed
```

The `catalog-seed` service idempotently adds an original clothing catalogue of 110 products across fashion categories using Unsplash-hosted product photography, including size/color inventory options. It adds missing products, and only upgrades one of its own existing seed products when it has no variants; it preserves that product’s existing stock and other data. It does not delete products or overwrite products that already have variants. Images are loaded by the storefront from HTTPS image URLs; admin-uploaded images continue to use the local media endpoint. External demo photography requires an internet connection. The AI fitting-room API requires an eligible locally uploaded image and `FASHN_API_KEY`; remote demo image URLs are intentionally not passed to that service.

Open the storefront at `http://localhost:8080`. The API is proxied through the frontend at `/api/`; health checks are available at `/health/ready` on the backend container. If Docker reports a virtualization/WSL error on Windows, enable CPU virtualization in UEFI/BIOS and enable the Windows features **Virtual Machine Platform** and **Windows Subsystem for Linux**, then restart Windows and launch Docker Desktop before retrying.

## Requirements

Use a Node.js release supported by Angular 22: Node `22.22.3+` in the 22.x line, `24.15.0+` in the 24.x line, or `26.0.0+`. The frontend package declares this supported range. Use a current npm release. MongoDB must be configured as a replica set because the checkout, stock and payment workflows use transactions.

## 1. Configure MongoDB

For local development, start MongoDB as a replica set named `rs0`. In the MongoDB configuration, set `replSetName: rs0`, then run `rs.initiate()` once in `mongosh` if it has not been initialized. Confirm it is healthy with `rs.status()`.

## 2. Configure and start the backend

In PowerShell:

```powershell
cd Backend
Copy-Item .env.example .env
```

Edit `Backend/.env`, set a unique randomly generated `JWT_SECRET` of at least 32 characters, and check `MONGO_URI`, `ALLOWED_ORIGINS`, `PORT` and `JWT_EXPIRES_IN`. Do not commit or send the real `.env` file.

Then run:

```bash
npm ci
npm run check:syntax
npm test
npm run dev
```

The API starts on port `3000` after MongoDB connects. The development command uses Node’s built-in `--watch` mode and does not require `nodemon`. Product media is served through `/api/v1/media/products/<filename>`. Admin uploads use `img` for the primary image and may use `images` for up to four additional images; five images total maximum, PNG/JPEG only, 2 MiB each.

### First administrator

Public registration creates a regular customer only. Register the intended admin account, then promote that account manually in the controlled development database. For example:

```javascript
use mean-l2
db.users.updateOne(
  { email: "your-admin-email@example.com" },
  { $set: { role: "admin" } }
)
```

Confirm the actual collection name first. Do not create a public admin-signup form or publish admin credentials.

## 3. Configure and start the frontend

Open a second terminal:

```bash
cd Frontend
npm ci
npm run build
npm start
```

Open `http://localhost:4200`. The Angular development proxy forwards both `/api` and `/socket.io` to `http://127.0.0.1:3000`. This keeps development API URLs consistent across components and lets the Socket.IO client use the same local backend.

## Main routes

- Public: `/home`, `/products`, `/products/:slug`, `/login`, `/signup`.
- Customer: `/cart`, `/wishlist`, `/checkout`, `/orders`, `/profile`, `/refunds`.
- Administrator: `/dashboard/home`, `/dashboard/products`, `/dashboard/categories`, `/dashboard/orders`, `/dashboard/refunds`, `/dashboard/reports`.

Frontend guards improve navigation, but security comes from backend `authenticate` and `authorize` middleware. Never rely on the browser guard alone.

## Course-project order and payment scope

This project stores the customer name, phone, and delivery address on an authenticated order. It does **not** calculate shipping fees, model carrier tracking, or integrate card/wallet/online payments. The only payment method available to customers is **cash on delivery (COD)**. An authorized administrator moves an order into `processing`, records cash collection, and then marks the paid order `completed`. This project uses a zero-discount rule; discounts are not currently offered. Refunds are administrative records and do not move money automatically. Guest carts are allowed, but creating an order requires an authenticated customer account. Older guest orders (if present in an existing database) retain their private-token access flow. Angular SSR is **not configured in this archive**; SEO support includes a generated sitemap/robots file and product metadata/JSON-LD, while product markup is currently rendered in the browser.

## Variants, cart compatibility and UI behavior

- Products with variants require a deliberate size/color choice on their detail page. Catalogue cards and wishlist entries route to the choice screen rather than submitting an invalid variant-less quick-add request. Existing simple products without variants keep the prior quick-add flow.
- Cart and order snapshots distinguish product options. If an option becomes unavailable after it was added, remove that line and choose another option; the backend always rechecks the selected SKU, price and stock.
- In product administration, option stock values are whole numbers; price overrides are optional; option combinations must be unique; and already-persisted options are disabled rather than removed to preserve history. The aggregate product stock is calculated from active variants.

## Validation

- Project structure/import/template-reference check: `node scripts/check-project-structure.js` from the repository root.
- Last verified run on this source (local, Windows, Node 24): `npm test` in `Backend/` — 168 of 168 pass; `npm test` in `Frontend/` — 68 of 68 pass; `npm run build` — no warnings (initial bundle about 490 kB against a 500 kB budget); `npm audit --omit=dev` — 0 vulnerabilities in both apps. Docker/Compose images and a live hosted deployment were not built or tested here.
- The backend tests start temporary in-memory MongoDB replica sets (`mongodb-memory-server`). MongoDB refuses to start with under 500 MB free on the drive that holds the temp directory, so low disk space appears as `OutOfDiskSpace` or `No space left on device` failures in the checkout, payment and refund tests. Free disk space before treating those as code failures.
- Backend syntax: `npm run check:syntax` inside `Backend/`.
- Backend unit/integration tests: `npm test` inside `Backend/`.
- Frontend unit tests: `npm test` inside `Frontend/` (Vitest via Angular; covers the login welcome toast).
- Angular compiler/template build: `npm run build` inside `Frontend/`.
- The current, consolidated checks and outstanding gaps are documented in `RELEASE-READINESS.md`. Static checks alone are not proof of live database or end-to-end correctness; review the required checklist in `SECURITY-AND-RUNBOOK.md`.

## Performance and deployment limits

The code uses server-side pagination with bounded page sizes, indexes for common queries, a bounded product-list cache, atomic stock updates, and checkout idempotency keys. Local development defaults to in-process cache and rate-limiter state; the supplied Docker Compose profile selects MongoDB-backed shared stores for multiple API replicas. These are foundations, not a guarantee of a particular concurrency level. Run the included k6 smoke script against staging, then perform realistic load/stress tests with monitoring before estimating capacity.

Dockerfiles, Docker Compose and a GitHub Actions workflow are included, but no image was built and no public deployment URL or production secrets are included. Run the full integration suite and Angular production build on the supported Node version, then validate the Compose stack and load tests in staging before production deployment. Angular SSR is not present because the required dependency could not be installed in this isolated environment; do not treat the current frontend as SSR until it has been added and built successfully.

## Professional UI interactions and motion

The storefront and dashboard share a restrained interaction layer: subtle hover/press feedback for actionable controls, short entrance transitions for key page sections and cards, and small cart/notification badge transitions. Status and navigation icons use restrained text glyphs or inline SVG rather than decorative emoji. These visual enhancements do not change order, stock, payment, or authorization logic. The `prefers-reduced-motion` setting disables non-essential animation for users who request reduced motion. Controls remain available to touch and keyboard users.

Theme notes: the storefront supports light and dark themes through the `data-theme` attribute and the CSS variables in `Frontend/src/styles.css` (`--text-muted`, `--link-accent`, `--tan-accent`, `--surface-soft`). Use those variables for text colours instead of hard-coded greys so both themes keep readable contrast. Dark-theme rules for a component must not be written as `:root[data-theme='dark'] ...` inside that component's stylesheet: Angular's view encapsulation makes such selectors unmatchable. Put them in `styles.css` or use `:host-context([data-theme=dark])`. The admin dashboard is designed on a light surface, so it renders in the light theme while open (`ThemeService.useLightSurface()`); the visitor's saved theme is restored when leaving it.

