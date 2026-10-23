# Mmarket Store — Architecture and Instructor-Style Mapping

## Architecture at a glance

Mmarket remains the same MEAN e-commerce application: Angular standalone frontend, Express REST API, and MongoDB through Mongoose. The backend is organized in the same approachable layer-first MVC style as the supplied `myStoreAPI` reference (`config/`, `controller/`, `middlewares/`, `model/`, `route/`, `service/`, and `utilities/`). Existing storefront features, endpoint contracts, database schemas, business rules, and frontend screens are preserved; this is a backend organization/import-path change, not a replacement store.

```text
Browser
  └─ Angular Router
      ├─ layout/       Public storefront screens
      ├─ dashboard/    Admin screens (admin route guard)
      ├─ shared/       Header, footer, common UI
      └─ core/
          ├─ models/   Typed API/domain contracts
          ├─ services/HTTP requests and client-side state
          └─ guards/interceptors/resolvers
                │ HTTP / Socket.IO
                ▼
Express API
  ├─ middlewares/     Authentication, authorization, validation, security, logging
  ├─ config/         MongoDB and environment configuration
  ├─ route/          Endpoint declarations, keeping existing /api/v1 URLs
  ├─ controller/     Request/response handling and validation orchestration
  ├─ service/        Multi-step commerce and infrastructure workflows
  ├─ model/          Mongoose schemas
  └─ utilities/       Shared cache, notifications, logging helpers
                │
                ▼
            MongoDB
```

## Instructor-style conventions retained

The supplied `myStore` example uses standalone Angular components, explicit imports, Angular Router, separate component TypeScript/template/stylesheet files, and service-based HTTP access. The Mmarket frontend follows those same approachable conventions:

- Feature screens keep a dedicated `.ts`, `.html`, and `.css` file.
- API calls live in `core/services/`; request/response shapes live in `core/models/`.
- Navigation stays in `app.routes.ts` and uses Angular Router.
- Forms use Angular Forms with explicit validation and user feedback.
- The backend follows the reference project’s conventional Express route → middleware → controller → service/model flow; shared middleware and utilities are kept separate. The filenames keep each feature clear without changing public API paths.

The instructor archive also contains a non-standard `Service` decorator example. Angular does not provide `@Service()`; application services should use `@Injectable(...)`. Mmarket keeps the instructor's simple organization and correct Angular APIs rather than copying broken imports/decorators or flattening the existing commerce code into the starter app.

## Main feature boundaries

- **Catalog:** product/category APIs, filters, bounded pagination, product detail and inventory options.
- **Identity:** registration, login, profile, token/session handling, protected customer and admin routes.
- **Commerce:** guest/customer cart state, server-validated orders, stock/payment status workflows, refunds and reports.
- **Notifications:** REST notification history plus authenticated Socket.IO events.
- **CMS:** `Backend/route/siteContent.route.js`, `Backend/controller/siteContent.controller.js`, and `Backend/model/siteContent.model.js` own persisted brand settings, announcement, navigation, footer, homepage settings/sections, and plain-text content pages. `Frontend/src/app/dashboard/content/` provides admin editing; the storefront header/footer/home and content routes read public content through `SiteContentService`.

## CMS routes

| Route | Access | Purpose |
|---|---|---|
| `GET /api/v1/site-content/public` | Public | Published storefront settings and safe public metadata |
| `GET /api/v1/site-content/public/pages/:slug` | Public | One published page body |
| `GET /api/v1/site-content/admin` | Admin | Read editor state, including drafts/archived pages |
| `PUT /api/v1/site-content/admin` | Admin | Update validated site settings/navigation/footer/homepage content |
| `POST /api/v1/site-content/admin/pages` | Admin | Create a content page |
| `PUT /api/v1/site-content/admin/pages/:id` | Admin | Update and publish/unpublish/restore a page |
| `DELETE /api/v1/site-content/admin/pages/:id` | Admin | Archive rather than permanently delete a page |

Public-facing content uses bounded plain text rather than arbitrary HTML. Internal menu and button destinations must be same-origin paths; external social/image URLs must use HTTPS. These rules reduce the CMS's XSS/open-redirect exposure, but do not replace a full security review.

## Runtime and delivery boundaries

- MongoDB must use a replica-set configuration for the transactions already used by checkout/inventory workflows.
- Docker Compose provides a reproducible local stack when Docker Engine is available.
- Runtime public frontend configuration is intended to keep API/media/socket origins outside the compiled JavaScript bundle.
- The current package still uses SPA hosting configuration. **True Angular SSR and hydration are not present in this ZIP and must not be claimed as implemented.**
- CI/configuration files are source artifacts only until a runner or deployment environment executes them successfully.

## Instructor-style data flow example

1. A storefront/dashboard component binds fields and handles the user's action.
2. Its feature service sends an HTTP request through `HttpClient`.
3. Express routes apply authentication/authorization middleware where required.
4. A controller validates and normalizes input before using a Mongoose model.
5. MongoDB stores the record; the API returns a typed response.
6. The component updates its visible state and presents success/error/loading feedback.

Admin UI visibility is not authorization. CMS writes and commerce operations must remain protected in Express even if an admin-only route guard exists in Angular.
