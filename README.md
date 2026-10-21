# Caliber MIS

MIS opens at an explicit sign-in page on every new page load. Sign in with Pulse opens Pulse's existing username-and-password form using `login=1`, including when Pulse is already signed in. After successful authentication, Pulse returns to the empty MIS workspace. MIS does not restore saved browser sessions or automatically start sign-in. The authenticated home contains only a Caliber MIS heading, sign-out control and blank workspace for future features. `index.html` loads `src/mis-entry.jsx`; the inherited Pulse dashboard, menus and background services are not mounted. The separate MIS database remains in place.

The canonical MIS address is `https://pulse-ll.cmll.in`. The previous `pulseii.cmll.in` DNS/certificate binding remains available and forwards browser pages and sign-in callbacks to the canonical address. Existing health/version endpoints remain directly readable on the old hostname.

Pulse's existing authentication service retains its registered `pulseii.cmll.in` callback. MIS forwards that callback to `pulse-ll.cmll.in` with its single-use code/state intact; the host-only sign-in cookie is checked on the new domain. This avoids changing Pulse's authentication backend when renaming MIS.

Independent MIS application based on the existing local Pulse-II MIS workspace: React, Vite, Node.js, Express and PostgreSQL. The entry flow is Pulse → MIS in a new tab at https://pulse-ll.cmll.in → MIS dashboard using shared sign-in. `mis-shared-signin.mjs` implements the authorization-code handoff with S256 PKCE, browser-bound state, short-lived single-use codes and separate MIS sessions. End-to-end production sign-in still requires deployment and private user verification.

## Database isolation

Azure database `caliber_mis` exists on server `coalmine-fleet-pg-783`. It is a separate logical database on shared server infrastructure. Azure connections validate TLS certificates. The owner explicitly approved reusing the existing Pulse database administrator connection on 21 October 2026. In App Service, reuse its existing Key Vault reference and set `MIS_DATABASE_CONNECTION_MODE=shared-admin`; this mode accepts only the approved Azure server, removes connection URL overrides and forces the actual connection to `caliber_mis`, regardless of the source URL's database name. This shares administrator authority across the server; it does not provide the isolation of a restricted database role. No Pulse password is reset.

No Pulse business records, password hashes or local database files are copied. The application creates its own schema on startup. MIS accepts identities authorized by Pulse (MIS User, MIS Manager or eligible administrators), without requiring a separate MIS user password. Pulse sign-out invalidates the linked MIS session on its next authenticated request. HR, Account and Tender identities are excluded. Scheduled background jobs default to disabled.

## Build and run

Use Node.js 22. Run `npm ci`, `npm run build`, then `npm start`. Configure environment settings from `.env.example` through Azure App Service; never commit credentials. Local development also requires a PostgreSQL database named `caliber_mis`.

## Deployment status

Azure Web App `caliber-mis-783` uses the existing `ASP-coalminefleetmaintenancerg-b234` Linux plan in Central India and subscription `58ca09cf-ab5d-47a8-a438-e1fb2a40d030`. Its runtime is Node.js 22; `npm start` launches `server.mjs`, which reads `PORT` (configure 8080). No new hosting plan was created. GitHub Actions with Azure OIDC deployed commit `93f20810bd636b51ac77a740da392e3899b22425` successfully in [run 39557861853](https://github.com/caliberaitech783-beep/caliber-mis/actions/runs/39557861853). Deployment success does not establish application health.

DNS and HTTPS for `pulse-ll.cmll.in` were configured and verified on 21 October 2026, using an App Service Managed Certificate and SNI SSL. `PUBLIC_APP_URL=https://pulse-ll.cmll.in`, `DISABLE_SCHEDULED_JOBS=true`, `META_WHATSAPP_DELIVERY_PAUSED=true`, `PORT=8080`, Node 22 and `npm start` are configured. Database schema and production shared sign-in require runtime verification after the connection is available. The MIS app needs its own managed identity, access to the existing database secret and the existing private application subnet. Do not copy unrelated Pulse integrations or settings. HR deployment is outside this application's deployment scope.

Verify `/`, `/api/app-version` and `/api/health` over HTTPS after configuration. The deployment workflow writes `DEPLOYMENT_SHA` into its artifact so health responses can identify the deployed commit. Verify database migrations separately before treating a database connectivity response as proof of complete initialization.

The Pulse login MIS button is reported to target https://pulse-ll.cmll.in in a new tab. Verify the end-to-end shared login flow before declaring the entry ready.

Pulse must deploy the matching shared-sign-in module and set `MIS_SSO_MODE=issuer`. MIS defaults to client mode. For isolated local development only, `MIS_SSO_MODE=off` retains local user authentication. The alternative restricted-role provisioning script remains available if the owner later chooses separate database credentials.

## Separate MIS credentials

The normal production MIS login uses a separate username/password assigned in
Pulse > Users & employees > MIS. The form permits independent desktop/mobile
master and working-menu selections, with Select all. Passwords are hashed only
in Pulse. The MIS backend forwards sign-in to the fixed HTTPS Pulse issuer,
retains an opaque grant server-side, and validates it on authenticated requests.
Seven-day central expiry, disabled accounts, password/username changes and central
session revocation invalidate the grant. No database connection is shared by this
login integration.

`mis-application-access.mjs` filters navigation and enforces the same allowlisted
menus on APIs, including database-resolved card types. Unassigned API routes fail
closed. Existing Pulse SSO is disabled for production sessions by default;
`MIS_LEGACY_SSO_ENABLED=true` is an explicit legacy compatibility option. Local
`MIS_SSO_MODE=off` authentication remains available for isolated development.
Deploy the matching Pulse identity endpoints before enabling this client release.
No accounts or credentials are pre-created by deployment; administrators must
configure each user in Pulse.
