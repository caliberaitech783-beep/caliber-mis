# Deployment procedure

Set by the owner on 14 November 2026; scheduled releases start on 15 November 2026.

- Work and test changes locally. A merge to `main` does not deploy anything by itself.
- Production (`.github/workflows/main_caliber-mis-783.yml`) releases everything merged to `main` together four times a day: 12:00, 15:00, 18:00 and 00:00 IST. Changes from every person and every computer that reach `main` go out in the next window.
- A window skips the release when `main` has nothing new since the commit Pulse-II serves, or only documentation changed (`scripts/release-window.sh`).
- A window release goes out only in the hour after 12:00, 15:00, 18:00 or 00:00 IST, so a timed run that GitHub starts hours late deploys nothing mid-shift. Because GitHub starts timed runs late or not at all, a backup trigger may start the workflow with "Scheduled window now (backup trigger: releases only in the hour after a window)"; it follows the same rules, and a duplicate run in the same window finds nothing new.
- The backup trigger is Pulse-II itself (`server/services/release-window-trigger.mjs`): 1 to 20 minutes after each window it starts the workflow through the GitHub API, once per window across all server instances. It runs only when the Azure setting `MIS_RELEASE_DISPATCH_TOKEN` holds a GitHub fine-grained token for this repository with "Actions: read and write"; `/api/health` shows `releaseWindowTrigger` (configured, last start). Never give this token to the test platform. The token expires on the date chosen when it was made; renew it before then.
- Merging to `main` is the step that queues a change for the next window, so complete and test the current group of changes before merging, and ask the user once before merging it.
- Run workflow on "Build and deploy main to production - caliber-mis-783" asks whether the release is urgent or can wait for the next scheduled window. "Next scheduled window" deploys nothing and names the window. "Urgent" needs the owner's OTP (added 14 November 2026):
  1. Run it with Urgent and no OTP: Pulse-II sends the same six-digit OTP on Telegram to the owner (the MIS login registered to +91 9925565281) and to Mr Mohit Chadda (login mohitchadda); either can approve. WhatsApp to the owner only if neither has linked Telegram. The message names who asked and the GitHub run. Nothing deploys.
  2. Run it again with Urgent and that OTP within 10 minutes: Pulse-II checks it (single use, five wrong attempts) and `main` is released at once.
  From a Claude session: `gh workflow run main_caliber-mis-783.yml --ref main -f when='Urgent: deploy now (needs OTP from the owner)'`, ask the owner for the OTP, then run it again adding `-f otp=<OTP>`. Start an urgent release only when the user explicitly asks for an immediate deployment; never guess or reuse an OTP.

# Report operating manuals

Switched off by the owner on 13 November 2026, because building the English and Hindi manual for every report change took too long. This replaces his rule of 9 November 2026.

- Do not write, build or update an operating manual for any report tab or sub tab, in English or Hindi.
- No report tab shows an "Operating manual" bar. The manual PDFs (`public/guides`), their text and build scripts (`scripts/report-guides`) and the check that stopped deployments (`test/report-guides.test.mjs`) were removed.
- A release does not delete files that left the package, so old manual PDFs can remain on the server's disk. The server refuses every `/guides` address (`protectStaticFiles` in `server/middleware/http-security.mjs`); do not put anything else under `public/guides`.
- To delete such leftover files from the servers' disks, start the workflow "Remove retired files from the servers" by hand (`.github/workflows/remove-retired-server-files.yml`). It lists unless "delete" is ticked, and removes only the file names listed in `scripts/remove-retired-server-files.mjs` from both Pulse-II slots and the scan engine server. It restarts nothing.
- A branch that still carries manual changes must drop them before it merges.
- The old manuals and their build scripts stay in git history (last present in commit `2872070`) if the owner asks for them again.
