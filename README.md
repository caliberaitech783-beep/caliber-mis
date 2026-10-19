# Caliber MIS

Independent MIS application based on the existing local Pulse-II MIS workspace: React, Vite, Node.js, Express and PostgreSQL. The intended entry flow is Pulse → MIS → MIS login → MIS dashboard.

## Database isolation

Azure database `caliber_mis` was created on server `coalmine-fleet-pg-783` on 19 October 2026. It is a separate logical database on shared server infrastructure. The application refuses to start with a missing database URL or any database name other than `caliber_mis`. Azure connections validate TLS certificates. Provision a dedicated restricted database role before deployment; do not reuse Pulse's administrator account.

No Pulse records, passwords, sessions, local database files or integration credentials are included. The new database starts empty. The application creates its own schema on startup. An authorised administrator must provision the initial MIS login explicitly. Scheduled background jobs default to disabled.

## Build and run

Use Node.js 22. Run `npm ci`, `npm run build`, then `npm start`. Configure environment settings from `.env.example` through Azure App Service; never commit credentials. Local development also requires a PostgreSQL database named `caliber_mis`.

## Deployment status

Repository, Azure database and Azure Web App `caliber-mis-783` exist. The Web App uses the existing `ASP-coalminefleetmaintenancerg-b234` Linux plan in Central India. No new hosting plan was created. Code deployment, dedicated database credentials, initial MIS administrator, DNS and HTTPS setup must be completed before activating the Pulse entry link. `mis.cmll.in` is the intended domain, not a claim that it is already configured. CI builds the source; Azure deployment is not connected yet.

The draft Pulse entry change is https://github.com/caliberaitech783-beep/coalmine-fleet-maintenance/pull/3. Keep it in draft until the full login flow has been tested.

An authorised PostgreSQL administrator can use `scripts/provision-mis-database.sql` in psql to create the dedicated `caliber_mis_app` role. It prompts for the new password privately. Store the resulting connection URL only in the MIS Web App's `DATABASE_URL` setting. The role receives no explicit permissions on Pulse tables. Existing server-level roles and PUBLIC grants still need to be considered when reviewing isolation; separate databases share infrastructure and are not equivalent to separate servers.
