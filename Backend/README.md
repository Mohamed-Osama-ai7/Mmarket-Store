# Mmarket Store API

Express 5 and Mongoose API for the Angular store in `../Frontend`. Its layout follows the conventional layer-first MVC pattern of the supplied `myStoreAPI` reference while retaining Mmarket's existing endpoints, schemas, and e-commerce business rules.

## Backend layout

- `config/` — database connection and environment validation.
- `middlewares/` — authentication, role authorization, CORS, rate limiting, uploads, request logging and centralized errors.
- `route/` — Express route declarations; the existing `/api/v1/...` prefixes are unchanged.
- `controller/` — request validation/orchestration and HTTP responses.
- `service/` — multi-step commerce and infrastructure operations.
- `model/` — Mongoose schemas.
- `utilities/` — shared cache, logging, notification publishing and Socket.IO helpers.
- `tests/` — unit and isolated integration tests.

## Local setup

1. Use a supported Node.js release and a MongoDB replica set (`rs0` for the supplied example).
2. Copy `.env.example` to `.env` and set a unique `JWT_SECRET` of at least 32 characters plus the remaining required values.
3. Run `npm ci`, then `npm run check` and `npm test`.
4. Start with `npm run dev` for development (Node built-in file watching; no `nodemon` dependency) or `npm start` for a normal process.

The server starts only after the MongoDB connection succeeds. Keep `.env`, logs, backups, uploads, and `node_modules` out of Git. `.env.example` is a template, not a production secret store.

## Site-content CMS API

The `route/siteContent.route.js`, `controller/siteContent.controller.js`, and `model/siteContent.model.js` files persist global storefront content in MongoDB. Public reads are mounted under `/api/v1/site-content/public`; page bodies are available only for pages whose status is `published`. Admin reads and writes use the existing `authenticate` + `authorize("admin")` middleware. Supported operations cover brand/SEO defaults, announcement settings, navigation links, footer groups/social links, homepage content/sections, and content-page create/update/archive workflows.

The business logic, API prefixes, and response behavior remain Mmarket-specific; the narrower `myStoreAPI` implementation and data models were not copied over the store. See `../ARCHITECTURE.md` and `../RELEASE-REPORT.md` for the mapping and current verification status.
