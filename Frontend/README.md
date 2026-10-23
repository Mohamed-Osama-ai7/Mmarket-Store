# Mmarket Storefront (Angular)

This is the Angular 22 customer-facing storefront for Mmarket. Components use the project teaching convention: separate `.ts`, `.html`, and `.css` files under `src/app/layout`, `src/app/dashboard`, and `src/app/shared`; reusable API/data logic belongs under `src/app/core`.

For full setup, environment variables, backend/database configuration, Docker, tests, and deployment, follow [`../README.md`](../README.md) and [`../DEPLOYMENT-GUIDE.md`](../DEPLOYMENT-GUIDE.md).

```powershell
npm ci
npm run build
npm test
npm start
```

The application requires a Node.js release supported by Angular 22 (Node 22.22.3+, 24.15.0+, or 26+). The development server uses `proxy.conf.json` for `/api` and Socket.IO traffic.
