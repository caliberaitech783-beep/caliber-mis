# Deployment procedure

Set by the owner on 14 November 2026; scheduled releases start on 15 November 2026.

- Work and test changes locally. A merge to `main` does not deploy anything by itself.
- Production (`.github/workflows/main_caliber-mis-783.yml`) releases everything merged to `main` together seven times a day: 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 and 00:00 IST (owner, 15 Nov 2026; before that 12:00, 15:00, 18:00 and 00:00). Changes from every person and every computer that reach `main` go out in the next window.
- A window skips the release when `main` has nothing new since the commit Pulse-II serves, or only documentation changed (`scripts/release-window.sh`).
- A window release goes out only in the hour after 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 or 00:00 IST, so a timed run that GitHub starts hours late deploys nothing mid-shift. Because GitHub starts timed runs late or not at all, a backup trigger may start the workflow with "Scheduled window now (backup trigger: releases only in the hour after a window)"; it follows the same rules, and a duplicate run in the same window finds nothing new.
- The backup trigger is Pulse-II itself (`server/services/release-window-trigger.mjs`): 1 to 20 minutes after each window it starts the workflow through the GitHub API, once per window across all server instances. It runs only when the Azure setting `MIS_RELEASE_DISPATCH_TOKEN` holds a GitHub fine-grained token for this repository with "Actions: read and write"; `/api/health` shows `releaseWindowTrigger` (configured, last start). Never give this token to the test platform. The token expires on the date chosen when it was made; renew it before then.
- Every production release job ends by sending the owner a Telegram report (`scripts/send-release-report.mjs`, `server/routes/release-report.mjs`): done or failed, how it was started (GitHub timer, Pulse-II trigger, urgent OTP), the version before and after, and every pull request on `main` between them. It goes to the MIS logins registered to the owner's number that have linked Telegram. A failed report never fails the release.
- Merging to `main` is the step that queues a change for the next window, so complete and test the current group of changes before merging, and ask the user once before merging it.
- Run workflow on "Build and deploy main to production - caliber-mis-783" asks whether the release is urgent or can wait for the next scheduled window. "Next scheduled window" deploys nothing and names the window. "Urgent" needs the owner's OTP (added 14 November 2026):
  Since 15 Nov 2026 (owner's choice) Urgent with no OTP sends **Approve / Reject** buttons on Telegram to the owner (MIS login registered to +91 9925565281) and Mr Mohit Chadda (login mohitchadda); the run waits up to 20 minutes and releases on the first Approve, stops on Reject or no tap. The OTP steps below are only the fallback when the buttons cannot be sent (nobody linked Telegram):
  1. Run it with Urgent and no OTP: Pulse-II sends the same six-digit OTP on Telegram to the owner (the MIS login registered to +91 9925565281) and to Mr Mohit Chadda (login mohitchadda); either can approve. WhatsApp to the owner only if neither has linked Telegram. The message names who asked and the GitHub run. Nothing deploys.
  2. Run it again with Urgent and that OTP within 10 minutes: Pulse-II checks it (single use, five wrong attempts) and `main` is released at once.
  From a Claude session: `gh workflow run main_caliber-mis-783.yml --ref main -f when='Urgent: deploy now (needs OTP from the owner)'`, ask the owner for the OTP, then run it again adding `-f otp=<OTP>`. Start an urgent release only when the user explicitly asks for an immediate deployment; never guess or reuse an OTP.

- Merge a pull request and make it live in one step: "Merge a PR and make it live (Telegram approval)" (`.github/workflows/merge-and-release.yml`, added 15 Nov 2026 at the owner's request). It checks the PR (open, against main, not a draft, mergeable, every check green), then sends the same Approve / Reject buttons naming the PR, its size, who asked, the computer, its IP (as given by the requester) and the GitHub account. On Approve it merges exactly the approved head commit and starts the production release with that approval, which the release spends once within 30 minutes. Reject, no tap in 20 minutes, or new commits on the PR: nothing is merged. Urgent runs of the production workflow also take `requested_by`, `computer` and `ip` and show them in the message. Both workflows take `brief`: what it fixes, one or two plain points split by `|`, shown first under "What it fixes" (owner, 15 Nov 2026); for a PR left empty it is taken from the PR description. Approve / Reject lapses after 20 minutes; the OTP fallback stays 10.
  From a Claude session, only when the user asks for a named PR to be merged and made live now: `gh workflow run merge-and-release.yml --ref main -f pr=<number> -f brief="<point 1> | <point 2>" -f requested_by="Claude Code session for <user's name>" -f computer="$COMPUTERNAME" -f ip="$(curl -s https://api.ipify.org)"`, then tell the user to tap Approve on Telegram. Never type an OTP or an approval on the user's behalf.

# Report operating manuals

Switched off by the owner on 13 November 2026, because building the English and Hindi manual for every report change took too long. This replaces his rule of 9 November 2026.

- Do not write, build or update an operating manual for any report tab or sub tab, in English or Hindi.
- No report tab shows an "Operating manual" bar. The manual PDFs (`public/guides`), their text and build scripts (`scripts/report-guides`) and the check that stopped deployments (`test/report-guides.test.mjs`) were removed.
- A release does not delete files that left the package, so old manual PDFs can remain on the server's disk. The server refuses every `/guides` address (`protectStaticFiles` in `server/middleware/http-security.mjs`); do not put anything else under `public/guides`.
- To delete such leftover files from the servers' disks, start the workflow "Remove retired files from the servers" by hand (`.github/workflows/remove-retired-server-files.yml`). It lists unless "delete" is ticked, and removes only the file names listed in `scripts/remove-retired-server-files.mjs` from both Pulse-II slots and the scan engine server. It restarts nothing.
- A branch that still carries manual changes must drop them before it merges.
- The old manuals and their build scripts stay in git history (last present in commit `2872070`) if the owner asks for them again.

# Scan card review shows all values by default

Set by the owner on 15 November 2026.

- Every scanned card (VLB and ELB, review page or batch page) opens with all of its values visible ("Show all values" is the default).
- The view narrows to "Show only fields needing input" only when the user clicks that button, and stays as the user left it until they click "Show all values" again. Opening a card, moving to the next card, changing the issue group or opening the review page never hides values by itself.
- Do not change this default; `test/scan-review-page.test.mjs` checks it.

# Report step style

Set by the owner on 15 November 2026: every report, today's and every future one, is drawn like the OT Multiple Duties Step 1 / Step 2 / Step 3 tables. Only the format follows that look; each report keeps its own rows, columns and colours.

- A drill-down keeps its steps one below the other: Step 1 stays on screen, Step 2 opens under it, Step 3 under that. Pressing a line in a step opens or changes the step below; the line that opened it is outlined in purple. Never replace one step with the next (`level===N&&`); show every step up to the one open (`level>=N&&`).
- Build every report step with `ReportSection` (src/main.jsx). Its table draws in the step look by itself (`src/report-step-style.css`): a coloured Sr. No. column (owner, 17 Nov 2026: 1-5 red, 6-10 orange, 11 onwards green, only the number's cell coloured; the same colours go into Smart Print, PDF and Excel through `shared/serial-column.mjs`; a total line has no number), grey capital headings that wrap instead of scrolling sideways, figures on the right, soft square colour boxes, a purple band for the line of all of them. A new report needs no styling of its own for this.
- Title each step `Step 1 · …`, `Step 2 · …`: a step that opens below the screen is scrolled into view by that title.
- The pattern, confirmed by the owner on 15 November 2026 with a sample (P1, then P2 under it, then P3): **Step 1** one line per site; **Step 2** the date by shift table, built with `DateShiftGrid` (src/date-shift-grid.jsx): dates down the side, the shifts across, in each shift box the count followed by a coloured box for every colour there, then the day totals and an All dates line; pressing a count or a colour opens **Step 3** (that date and shift) under it. Never draw Step 2 as one line per date and shift.
- A step titled `Step N · …` shows only its title and Smart Print above the table: no search box, record count, Rows or Actions, every line on screen, every column (no saved layout hides one), and the table fits the screen (headings and names wrap; codes such as door numbers stay on one line).
- Owner, 19 Nov 2026: a Step table's headings sort on one click (a second click reverses it), with no ↑ / ↓ / filter menu; the total line stays at the bottom. `ReportSection` does this by itself for every `Step N · …` title; hand-drawn step tables use `SortableHeader` from `src/sortable-table.jsx`.
- `test/report-step-style.test.mjs` checks this.

# Sidebar auto-hides while a scan card is open

Set by the owner on 15 November 2026.

- Whenever a VLB, LMV or ELB scan card is open for processing ("Review all card values", review page or batch page), the left sidebar runs in auto-hide: it stays closed and opens only while the pointer is at the left edge or inside it.
- Leaving the card (no card selected, back to card status, another page) returns the sidebar to the user's own setting; the forced auto-hide is never saved as the user's setting.
- `src/scan-card-sidebar.mjs` holds the rule; `test/scan-card-sidebar.test.mjs` checks it. Do not remove it.

# Employee Transfer from HR (Employee Master is not synced)

Set by the owner on 23 November 2026: "do not sync Employee Master, sync only Employee Transfer".

- Sync all masters has one HR line, Employee Transfer, copied from HR (hrpulse.cmll.in) every hour and on Sync, with a Preview that writes nothing (`server/services/hr-employee-sync.mjs`, `server/routes/master-sync.mjs`). An HR-approved transfer moves the worker from the transfer date as an approved move (`applyEmployeeSiteMove`), once per HR transfer (`hr_transfer_sync`). A transfer whose person is not in Employee Master, or whose site is not ours, waits and is retried.
- Employee Master has no line and is not synced from HR or copied from Oracle / ERP; it is kept from HR's master Excel on the Employee Master page. Do not add it back to Sync all masters unless the owner asks. The service still holds the Employee Master copy from HR (unused) for that day.
- HR serves the data read only at `/api/integrations/mis/transfers` (and `/employees`), caliber-hr repo `server/mis-employee-sync.mjs`. Pulse-II's Azure setting `HR_SYNC_KEY` must equal HR's `MIS_SYNC_KEY` (set 23 Nov 2026, on both Pulse-II slots, not slot-sticky). `HR_SYNC_SCHEDULE=0` stops the hourly run.
- `test/hr-employee-sync.test.mjs` checks this.
