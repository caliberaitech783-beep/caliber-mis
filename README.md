# Caliber MIS

Independent MIS application based on the existing local Pulse-II MIS workspace: React, Vite, Node.js, Express and PostgreSQL. The requested entry flow is Pulse → MIS in a new tab at https://pulseii.cmll.in → MIS dashboard using shared sign-in. Shared sign-in has not yet been implemented or verified; the current application authenticates against its own database.

## Database isolation

Azure database `caliber_mis` was created on server `coalmine-fleet-pg-783` on 19 October 2026. It is a separate logical database on shared server infrastructure. The application refuses to start with a missing database URL or any database name other than `caliber_mis`. Azure connections validate TLS certificates. Provision a dedicated restricted database role before deployment; do not reuse Pulse's administrator account.

No Pulse records, passwords, sessions, local database files or integration credentials are included. The new database starts empty. The application creates its own schema on startup. An authorised administrator must provision the initial MIS login explicitly. Scheduled background jobs default to disabled.

## Build and run

Use Node.js 22. Run `npm ci`, `npm run build`, then `npm start`. Configure environment settings from `.env.example` through Azure App Service; never commit credentials. Local development also requires a PostgreSQL database named `caliber_mis`.

## Deployment status

Azure Web App `caliber-mis-783` uses the existing `ASP-coalminefleetmaintenancerg-b234` Linux plan in Central India and subscription `58ca09cf-ab5d-47a8-a438-e1fb2a40d030`. Its runtime is Node.js 22; `npm start` launches `server.mjs`, which reads `PORT` (configure 8080). No new hosting plan was created. GitHub Actions with Azure OIDC deployed commit `93f20810bd636b51ac77a740da392e3899b22425` successfully in [run 39557861853](https://github.com/caliberaitech783-beep/caliber-mis/actions/runs/39557861853). Deployment success does not establish application health.

The intended domain is `pulseii.cmll.in`. Dedicated database credentials, schema initialization, initial MIS administrator, DNS, HTTPS and shared sign-in remain unverified. Configure `PUBLIC_APP_URL=https://pulseii.cmll.in`, `DISABLE_SCHEDULED_JOBS=true`, `META_WHATSAPP_DELIVERY_PAUSED=true` and `PORT=8080`. Enter `DATABASE_URL` privately in MIS App Service environment variables after provisioning its restricted role. Do not copy Pulse application settings or credentials. HR deployment is outside this application's deployment scope.

Verify `/`, `/api/app-version` and `/api/health` over HTTPS after configuration. The deployment workflow writes `DEPLOYMENT_SHA` into its artifact so health responses can identify the deployed commit. Verify database migrations separately before treating a database connectivity response as proof of complete initialization.

The Pulse login MIS button is reported to target https://pulseii.cmll.in in a new tab. Verify the end-to-end shared login flow before declaring the entry ready.

An authorised PostgreSQL administrator can use `scripts/provision-mis-database.sql` in psql to create the dedicated `caliber_mis_app` role. It prompts for the new password privately. Store the resulting connection URL only in the MIS Web App's `DATABASE_URL` setting. The role receives no explicit permissions on Pulse tables. Existing server-level roles and PUBLIC grants still need to be considered when reviewing isolation; separate databases share infrastructure and are not equivalent to separate servers.
