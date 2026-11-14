# Six scan engines: setup and switch-on runbook

Date: 11 November 2026. Code: branch `feat/six-scan-engines`.

## What changes

| | Before | After |
|---|---|---|
| Queue | One queue for every site inside Pulse-II | One queue per site |
| Cards read at once | 5 for the whole company | 8 per site in the engines (setting `MIS_SCAN_LANE_CONCURRENCY`, max 10) |
| Gemini key | One shared key | One key per site (`GEMINI_API_KEY_<SITE>`), shared key as fallback |
| Where reading runs | Inside Pulse-II, on the same server as the screens | A separate Azure Web App, one process per site |
| A Pulse-II restart | Every card being read went back for a second Gemini read | Cards being read finish first (up to 45 s); unfinished cards are handed back once |
| An engine restart | n/a | Only at 20:45 IST, only when engine code changed; each engine finishes its cards first |
| An engine stops | n/a | Pulse-II reads that site itself within a minute |

Nothing changes in production until the settings below are switched on. Merging the code alone keeps one shared queue, as before, and adds the lease and clean-stop behaviour.

## Setting names for each site

| Site | Gemini key setting |
|---|---|
| Sasti OC | `GEMINI_API_KEY_SASTI_OB` |
| Majri OC | `GEMINI_API_KEY_MAJRI_OB` |
| Dhoptala OC (2nd) | `GEMINI_API_KEY_DHOPTALA_OB_2ND` |
| Gauri Pauni OC (2nd) | `GEMINI_API_KEY_GAURI_PAUNI_OB_2ND` |
| Jayant OC | `GEMINI_API_KEY_JAYANT_OB` |
| Dudhichua OC | `GEMINI_API_KEY_DUDHICHUA_OB` |
| Dudhichua East OC | `GEMINI_API_KEY_DUDHICHUA_EAST_OB` |
| Any site without its own key | `GEMINI_API_KEY` (existing) |

The names use OB because that is how the app stores site names internally. The engine health page (step 3) prints the exact setting name for each engine.

## Step 1: one Gemini key per site (owner)

For each site:

1. In Google Cloud console, create a new project, for example `caliber-scan-sasti`. **Separate projects are what give separate limits; several keys in one project share one limit.**
2. Link the project to a billing account (Billing > Link a billing account).
3. Enable the "Generative Language API".
4. Create an API key (APIs & Services > Credentials), restricted to the Generative Language API.
5. Check the project's rate limit for the model the app uses (`gemini-3.8-flash` by default, or the `MIS_GEMINI_MODEL` app setting) under Quotas.

The engine health page showing `"key": "site"` for every site proves only that each site has its own key, not that the keys come from separate projects. If the bill or the quota still behaves like one shared limit, open APIs & Services > Credentials in each project and confirm that no project holds more than one of the seven site keys.

Keys are never shared in chat or put in the repository. They go into Azure settings only (steps 2 and 4).

## Step 2: the engine Web App (owner)

1. Create a Linux Web App, Node 22, named `caliber-mis-scan-engine`, in resource group `coalmine-fleet-maintenance-rg`. Put it on its **own App Service plan**: the present plan is shared with Pulse and Pulse-II, and the point is to keep reading off their CPU. B2 (2 cores) is enough for seven engines because most of their time is spent waiting for Gemini. The portal shows the monthly price when you pick the size.
2. Configuration > General settings > Startup command: `node server/scan-engine.mjs`. Always On: on.
3. Identity > System assigned: on. Then on the scan storage account, grant this identity **Storage Blob Data Reader** (the engine only reads card images).
4. On the PostgreSQL server `coalmine-fleet-pg-783`, allow the engine app's outbound IP addresses (Networking), if access is not already open to Azure services.
5. Application settings (copy the values from `caliber-mis-783`):
   - `DATABASE_URL`, and `MIS_DATABASE_CONNECTION_MODE` if Pulse-II has it
   - `MIS_GEMINI_API` = `true`, `GEMINI_API_KEY` (shared fallback)
   - one `GEMINI_API_KEY_<SITE>` per site from the table above
   - `MIS_SCAN_BLOB_ENABLED`, `MIS_SCAN_BLOB_ACCOUNT`, `MIS_SCAN_BLOB_CONTAINER`
   - `MIS_SCAN_ENGINE_SITES` = `Sasti OC;Majri OC;Dhoptala OC (2nd);Gauri Pauni OC (2nd);Jayant OC;Dudhichua OC;Dudhichua East OC`
   - optional `MIS_SCAN_LANE_CONCURRENCY` = `8` (cards read at once per site, max 10)
   - `MIS_GEMINI_UPRIGHT_ONLY` = `true` (the nightly deploy sets it too; cards are fed upright, so the first read skips the 180 degree views and costs about half the image tokens)
6. Give the GitHub deploy identity (the one in the `AZUREAPPSERVICE_CLIENTID_…` secret) the Website Contributor role on the new app.
7. In GitHub > Settings > Variables, add `SCAN_ENGINE_APP` = `caliber-mis-scan-engine`.
8. Run the workflow "Deploy scan engines (nightly)" once by hand with "force" ticked, after 20:00.

## Step 3: check the engines

Open `https://caliber-mis-scan-engine.azurewebsites.net/health`. Every engine should show `"running": true` and `"key": "site"`. `"key": "shared"` means that site's setting name is wrong or empty.

## Step 4: switch Pulse-II over (after 20:00)

On `caliber-mis-783`, add:

- `MIS_SCAN_LANES` = `sites` (Pulse-II's own fallback reading also uses one queue per site)
- `MIS_SCAN_ENGINES` = `external` (leave each site with a running engine to that engine)
- the same `GEMINI_API_KEY_<SITE>` settings, so fallback reading also uses each site's key
- `MIS_GEMINI_UPRIGHT_ONLY` = `true` (the Pulse-II release sets it too), so fallback reads cost the same as engine reads

Saving settings restarts Pulse-II once. `https://pulse-ll.cmll.in/api/health` then shows `"scanReading": {"mode": "external", "liveEngines": 7, …}`.

**To undo:** delete `MIS_SCAN_ENGINES` on Pulse-II. Pulse-II then reads every site again.

## Step 5: no-downtime Pulse-II releases (owner)

1. Check that the plan of `caliber-mis-783` is Standard or Premium (deployment slots need it); if it is Basic, scale it up.
2. Deployment slots > Add slot `staging`, cloning settings from production.
3. In production Configuration, tick "Deployment slot setting" on every setting, so the values stay with production when a release swaps in.
4. Stop the `staging` slot (the release workflow starts it when needed).
5. Give the slot its own managed identity and the production app's network integration. Grant the slot identity access to the MIS database secret and scan blob container, and verify the integration encryption key is available in both slots.

The production workflow defaults to `staging`. Set the GitHub variable `MIS_STAGING_SLOT` only if the configured slot has a different name. The workflow checks the release, database and scan storage on the slot's Azure hostname. It copies local backups and scan archives to staging before the swap and records production response times during the swap. After production verification and a 60-second drain, it stops the old version and copies any files written during the transition. Eligible screen-only releases still use the UI update path.

## When Google refuses the reading account

On 12 November 2026 every site stopped reading at about 00:00 IST. Google answered every card with HTTP 402, its reply when the prepaid credit of the billing account is used up. Every site key stopped together, because the Google projects behind the keys are linked to one billing account and a billing account has one balance. More than 140 cards at four sites were marked "Error" before anyone knew why, and one site deleted its entry and scanned the cards again.

What Pulse-II does since then, for no credit (402), a refused key (401, 403) and a used-up quota (429):

- The card is not marked failed. It goes back to "Waiting for Gemini", that site's queue stops, one card is tried every minute, and reading carries on by itself as soon as Google answers.
- The scan screen shows a red line: the reading account is the reason, it is not a scanning mistake, the cards must not be scanned again.
- The administrators' Telegram group gets one message per outage, with Google's own words (only when Telegram is configured on Pulse-II).
- `https://pulse-ll.cmll.in/api/health` lists the held queues under `scanReading.blocked`.
- Cards that were marked failed for one of these reasons are queued again after the next card is read successfully.
- Under the Error tile the screen lists why the cards are there.

What the owner does when the line appears:

1. Open Google AI Studio > Billing with the Google account that owns the keys and buy credit. Reading restarts within a few minutes of the payment being confirmed.
2. Switch on auto-reload on the same page, with a monthly limit that covers a month of scanning, so the balance cannot reach zero during a shift.
3. For a refused key: create a new key in the same project and put it in the site's `GEMINI_API_KEY_<SITE>` setting on both apps.

Separate keys do not protect against this: only a second billing account would.

## Rules that still apply

- No merges to `main` between 06:00 and 20:00 on scanning days, except an urgent fix the owner approves.
- Engine code goes live at 20:45 IST at the earliest. Until then the engines run the previous version.
