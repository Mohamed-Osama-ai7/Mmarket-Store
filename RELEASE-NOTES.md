# Release Notes — Mmarket Store Final Release Candidate

This candidate was built from the latest source package available in the conversation and then updated with a database-backed Site Content CMS, storefront integration, regression guards, instructor-style architecture documentation, and a correction to the policy-page Angular template.

## Included improvements

- Preserved Mmarket's existing Angular / Express / Mongoose architecture and course-friendly component/service/module style.
- Added site-content schema/controller/routes and an admin dashboard for brand settings, announcement bar, navigation, footer, homepage content/sections, and draft/published/archived pages.
- Connected CMS content to the storefront home page, header, footer, public content page route, policy pages, and sitemap.
- Applied server-side admin authorization, bounded field validation, plain-text content handling, same-site internal links, HTTPS external URLs, slug-conflict checks, and reversible page archiving.
- Preserved the existing Zone.js compatibility fix for mutable fields updated in asynchronous callbacks.
- Fixed a malformed Angular control-flow block in the policy template and removed stale `noindex` metadata when a valid public content page is displayed.
- Added a static contract test for CMS permissions/content and policy template structure.
- Added `ARCHITECTURE.md` to explain the Mmarket architecture and how it aligns with the supplied `myStore` instructor project.

## Important remaining release gates

The Angular production compiler/build and real browser regression tests have not run in the packaging environment because the runtime's Node version is below the declared Angular requirement and npm registry access is unavailable. CMS live persistence/E2E, full Backend integration tests, Socket.IO browser behavior, Docker runtime, and Vercel deployment remain unverified. True Angular SSR/hydration is not included in this archive. The latest artifact-specific results are in `RELEASE-REPORT.md`; this archive is a release candidate, not a production-certified release.

## Local testing candidate merge — 22 October 2026
The packaged local-test candidate combines the latest wishlist-template and registration-response privacy fixes with the earlier refund completion contract and its service spec, and restores the API workflow integration test that was omitted from the updated archive. The refund completion reference (`providerRefundId`) is required by the backend. See `FINAL-RELEASE-VERIFICATION.md`; this archive is not production-certified until the full Windows build/test/live workflow run succeeds.
