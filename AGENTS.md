# Deployment procedure

Set by the owner on 14 November 2026; scheduled releases start on 15 November 2026.

- Work and test changes locally. A merge to `main` does not deploy anything by itself.
- Production (`.github/workflows/main_caliber-mis-783.yml`) releases everything merged to `main` together four times a day: 12:00, 15:00, 18:00 and 00:00 IST. Changes from every person and every computer that reach `main` go out in the next window.
- A window skips the release when `main` has nothing new since the commit Pulse-II serves, or only documentation changed (`scripts/release-window.sh`).
- Merging to `main` is the step that queues a change for the next window, so complete and test the current group of changes before merging, and ask the user once before merging it.
- An urgent fix outside the windows: Run workflow on "Build and deploy main to production - caliber-mis-783" releases `main` at once. Use it only when the user explicitly asks for an immediate deployment; then do not ask for a second confirmation.

# Report operating manuals

Switched off by the owner on 13 November 2026, because building the English and Hindi manual for every report change took too long. This replaces his rule of 9 November 2026.

- Do not write, build or update an operating manual for any report tab or sub tab, in English or Hindi.
- No report tab shows an "Operating manual" bar. The manual PDFs (`public/guides`), their text and build scripts (`scripts/report-guides`) and the check that stopped deployments (`test/report-guides.test.mjs`) were removed.
- A release does not delete files that left the package, so old manual PDFs can remain on the server's disk. The server refuses every `/guides` address (`protectStaticFiles` in `server/middleware/http-security.mjs`); do not put anything else under `public/guides`.
- To delete such leftover files from the servers' disks, start the workflow "Remove retired files from the servers" by hand (`.github/workflows/remove-retired-server-files.yml`). It lists unless "delete" is ticked, and removes only the file names listed in `scripts/remove-retired-server-files.mjs` from both Pulse-II slots and the scan engine server. It restarts nothing.
- A branch that still carries manual changes must drop them before it merges.
- The old manuals and their build scripts stay in git history (last present in commit `2872070`) if the owner asks for them again.
