# Mmarket Store — Final Repair Candidate Report

**Assessment date:** 22 October 2026  
**Source package:** `Mmarket_Store_Final_Reference_MVC.zip`  
**Reference architecture:** `myStoreAPI.zip` (MVC layout reference only)  
**Artifact status:** Updated release candidate; **not yet certified for final submission** because the Angular compiler/build and complete dependency-backed integration suite could not be run in this packaging environment.

## Changes applied in this artifact

1. **Fixed Angular wishlist action bindings** in `Frontend/src/app/layout/productslist/product/product.html` and `Frontend/src/app/layout/productslist/product-details/product-details.html`. Each template now reads `savedIds$` through `@let savedIds = ... | async` and passes the already-resolved value to click handlers. Angular pipes are no longer used inside action expressions, which Angular rejects during template compilation.
2. **Reduced registration response fields** in `Backend/controller/user.controller.js`. Public registration responses now omit `resetPasswordTokenHash`, `resetPasswordExpires`, and `mergedGuestCartKeys` in addition to `password`.
3. **Added regression tests** in `Backend/tests/frontend-template-safety.test.js` to scan Angular event bindings for invalid pipe expressions and to guard both wishlist templates.
4. **Strengthened `Backend/tests/user-registration.test.js`** to check that password and the three internal fields are absent from registration responses.
5. Added the new template-safety regression file to the existing `Backend` `test:unit` script. No new production dependencies were added.

The Backend retains the layer-first MVC layout already present in the source package: `config/`, `middlewares/`, `route/`, `controller/`, `service/`, `model/`, and `utilities/`. The app's existing feature code and API contracts were preserved.

## Checks executed against this artifact

| Check | Actual result |
|---|---|
| `npm run check --prefix Backend` | **PASS** — syntax check parsed 100 JavaScript files; import check resolved 253 relative imports and confirmed the MVC layout. |
| `node scripts/check-project-structure.js` | **PASS** — 24 checks, 0 warnings, 0 failures. This includes static source checks and TypeScript syntax transpilation, not Angular template compilation. |
| Focused regression/security tests | **PASS** — 15/15 tests: catalog seed definition, environment validation, rate limiting, CMS structure/contract, registration response, and new Angular event-binding/template guards. |
| Angular unit tests (`npm test --prefix Frontend`) | **BLOCKED** — `ng: not found`; Angular CLI dependencies are not installed in this environment. |
| Angular production build (`npm run build --prefix Frontend`) | **BLOCKED** — `ng: not found`; no Angular build result is claimed for this exact ZIP. |
| Full Backend suite (`npm test` in `Backend`) | **BLOCKED / INCOMPLETE** — 35 tests passed and 20 failed in the available partial test environment. Several test files could not load because dependencies including `slugify` and `mongodb-memory-server` were unavailable; logger-transport tests also could not run correctly with the temporary test-only transport shim used to load a subset. This run does not establish a product-code test failure rate. |
| Fresh `npm audit` | **BLOCKED** — this container could not resolve `registry.npmjs.org`; no fresh audit result is claimed. |
| Live API, browser, MongoDB, COD/refund/admin/Socket.IO workflows | **NOT RE-RUN** against this exact generated archive. No real database or payment was touched in this packaging pass. |

For the 15 focused tests, `NODE_PATH` pointed to a temporary external dependency subset, and a temporary test-only `winston-daily-rotate-file` compatibility shim was used solely to load the registration controller. The shim is **not** included in the release archive. The production `npm ci` environment should use the real locked package.

## Prior reported verification results (not independently reproduced in this archive)

Development progress notes described a separate working copy where the backend suite passed **160/160** with a real disposable MongoDB server, the Angular build succeeded with a bundle-budget warning, **18/18** frontend tests passed, and **50/50** live API checks passed. That report also explicitly noted no ZIP or report had been packaged in that environment. Because the separate working directory was not available to compare byte-for-byte, these results are recorded as prior reported evidence and are **not counted as tests performed on this archive**.

## Security and dependency notes

- No `.env`, credentials, `node_modules`, Angular `dist` output, or local database files are included.
- The lockfile in this artifact still pins `sanitize-html` at **2.18.0**. Prior progress notes indicated an earlier attempt to update to 2.18.1, but that lockfile change was not available in the packaged source used here. A fresh audit and a compatible lockfile update remain pending.
- Prior security review notes also observed two Frontend audit findings (one low, one high) in the Vite dependency path through `@angular/build`; it did not apply the offered force fix because that would downgrade Angular. Recheck this against the actual lockfile with `npm audit` before release.
- Do not use `npm audit fix --force`. Do not use real customer data or the `mean-l2` database for destructive integration tests.
- The documented checkout currently supports Cash on Delivery; do not describe card or wallet payments as implemented. True Angular SSR/hydration is also not included.

## Status summary

- **Backend MVC structure/imports:** `FIXED BUT NOT FULLY VERIFIED` — syntax/import/structure checks pass; complete runtime tests need the project dependencies and a disposable replica-set database.
- **Product List and Product Details wishlist templates:** `FIXED BUT NOT FULLY VERIFIED` — static regression tests pass; Angular compilation/browser checks are blocked here.
- **Registration response privacy:** `FIXED & VERIFIED` — targeted controller tests pass with assertions for the sensitive/internal fields.
- **My Orders, Returns/Refunds, Cart/Checkout, admin/COD, Notifications/Socket.IO:** `FIXED BUT NOT FULLY VERIFIED` — these workflows were not re-run against this exact generated ZIP during this packaging pass.
- **Dependency security audit:** `BLOCKED` — registry DNS/network failure prevented a fresh audit.

## Verify on Windows before submission

Use the project's intended Node.js/npm versions and a working npm registry connection. From the extracted project root:

```powershell
node -v
npm -v
node scripts/check-project-structure.js

cd Backend
npm ci
npm run check
npm run test:unit
npm test
npm audit
cd ..

cd Frontend
npm ci
npm test
npm run build
npm audit
cd ..
```

Run integration tests only against a disposable test database configured as a replica set. Then check the live UI/API flows (catalog → product details → wishlist/cart → checkout; orders → cancellation/returns; notifications → mark read) and review this report against the real test output. Do not call the release fully verified until these commands and workflows pass on the packaged source.
