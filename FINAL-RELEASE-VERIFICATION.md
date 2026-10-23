# Mmarket Store — Local Test Candidate Verification

**Prepared:** 22 October 2026  
**Artifact:** `Mmarket_Store_FINAL_TO_TEST.zip`  
**Status:** Best merged candidate for local testing; **not production-certified** until dependency-backed Angular build/tests and live workflows pass on the target Windows machine.

## Why this package combines both uploaded archives

- Retains the newer Angular wishlist template fixes that avoid pipes inside click/event expressions.
- Retains registration-response privacy safeguards and their strengthened regression tests.
- Restores two test files that were present in `Mmarket_Store_FINAL_VERIFIED.zip` but missing from the newer updated archive: the API workflow integration test and the RefundService contract test.
- Restores the refund completion flow from the verified archive. The backend requires a `providerRefundId`; the updated archive had removed that value from the Angular service/page call, which would make marking a refund as completed fail. The restored form asks for a confirmation reference and sends it to the API.
- No new production npm dependencies were added.

## Checks run while preparing this exact package

| Check | Result |
|---|---|
| `node scripts/check-project-structure.js` | PASS — 24 checks, 0 warnings, 0 failures (static structure/source checks; not an Angular build). |
| `npm --prefix Backend run check` | PASS — syntax parsed 101 JavaScript files; 257 relative imports resolved. |
| Focused dependency-free tests | PASS — 3/3 tests: 110-product catalog definition and two Angular event-binding/wishlist-template checks. |
| Refund completion contract | PASS — manually confirmed frontend sends `providerRefundId`, the UI requires a reference, and the service regression spec is restored. |
| Full Backend suite, API workflows, and MongoDB replica-set transaction paths | NOT certified by packaging checks; run on Windows with dependencies and a disposable test database. |
| Angular production build and Angular tests | NOT certified by packaging checks; run after `npm ci` in `Frontend`. |
| Fresh `npm audit` | NOT run for this merged package. Run with a working npm registry and review findings. |
| Browser/end-to-end live shop, cart, checkout, orders, refund, Socket.IO | NOT run against the user's local machine. |

## Test on Windows (PowerShell)

Use Node.js supported by Angular 22 (`22.22.3+` in 22.x or `24.15.0+` in 24.x). Start MongoDB configured as replica set `rs0` first. Then follow `START-HERE-WINDOWS.md` and the non-Docker steps in `README.md`.

From the extracted repository root:

```powershell
node scripts/check-project-structure.js
cd Backend
npm ci
npm run check
node --test tests/frontend-template-safety.test.js tests/catalog-seed-definition.test.js
npm run test:unit
npm test
cd ..\Frontend
npm ci
npm test
npm run build
```

`api-workflows.integration.test.js` uses `mongodb-memory-server` and a disposable replica set. If the database binary is not downloadable, the test is blocked rather than passed. Never point destructive integration tests at a real/customer database.

For local development without Docker, create `Backend/.env` from `Backend/.env.example`, set a unique `JWT_SECRET`, and keep `MONGO_URI=mongodb://127.0.0.1:27017/mean-l2?replicaSet=rs0` only if that is your local development database. Start the backend and frontend in separate terminals as documented in `README.md`. Do not run database reset commands against data you need to keep.
