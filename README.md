# Caliber MIS

Independent MIS application based on the existing local Pulse-II MIS workspace: React, Vite, Node.js, Express and PostgreSQL. The intended entry flow is Pulse → MIS → MIS login → MIS dashboard.

## Database isolation

Azure database `caliber_mis` was created on server `coalmine-fleet-pg-783` on 19 October 2026. It is a separate logical database on shared server infrastructure. The application refuses to start with a missing database URL or any database name other than `caliber_mis`. Azure connections validate TLS certificates. Provision a dedicated restricted database role before deployment; do not reuse Pulse's administrator account.

No Pulse records, passwords, sessions, local database files or integration credentials are included. The new database starts empty. The application creates its own schema on startup. An authorised administrator must provision the initial MIS login explicitly. Scheduled background jobs default to disabled.

## Build and run

Use Node.js 22. Run `npm ci`, `npm run build`, then `npm start`. Configure environment settings from `.env.example` through Azure App Service; never commit credentials. Local development also requires a PostgreSQL database named `caliber_mis`.

## Deployment status

Repository and Azure database exist. App Service deployment, dedicated database credentials, initial MIS administrator, DNS and HTTPS setup must be completed before activating the Pulse entry link. `mis.cmll.in` is the intended domain, not a claim that it is already configured. CI builds the source; deployment is configured separately after the Azure application is available.
