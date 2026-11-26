# Deployment procedure

Set by the owner on 14 November 2026; scheduled releases start on 15 November 2026.

- Work and test changes locally. A merge to `main` does not deploy anything by itself.
- Production (`.github/workflows/main_caliber-mis-783.yml`) releases everything merged to `main` together seven times a day: 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 and 00:00 IST (owner, 15 Nov 2026; before that 12:00, 15:00, 18:00 and 00:00). Changes from every person and every computer that reach `main` go out in the next window.
- A window skips the release when `main` has nothing new since the commit Pulse-II serves, or only documentation changed (`scripts/release-window.sh`).
- A window release goes out only in the hour after 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 or 00:00 IST, so a timed run that GitHub starts hours late deploys nothing mid-shift. Because GitHub starts timed runs late or not at all, a backup trigger may start the workflow with "Scheduled window now (backup trigger: releases only in the hour after a window)"; it follows the same rules, and a duplicate run in the same window finds nothing new.
- The backup trigger is Pulse-II itself (`server/services/release-window-trigger.mjs`): 1 to 20 minutes after each window it starts the workflow through the GitHub API, once per window across all server instances. It runs only when the Azure setting `MIS_RELEASE_DISPATCH_TOKEN` holds a GitHub fine-grained token for this repository with "Actions: read and write"; `/api/health` shows `releaseWindowTrigger` (configured, last start). Never give this token to the test platform. The token expires on the date chosen when it was made; renew it before then.
- Every production release job ends by sending the owner a Telegram report (`scripts/send-release-report.mjs`, `server/routes/release-report.mjs`): done or failed, how it was started (GitHub timer, Pulse-II trigger, urgent OTP), the version before and after, and every pull request on `main` between them. It goes to the MIS logins registered to the owner's number that have linked Telegram. A failed report never fails the release.
- Old screen files for open tabs (23 Nov 2026): a full release carries forward the files of the version live at that moment (always; the release stops if one cannot be read) and the files that left the build in the last 7 days (newest first, for at most 12 minutes), and nothing older (`scripts/preserve-live-ui-assets.mjs`). `RETIRED_UI_ASSETS.json` beside `DEPLOYMENT_SHA` travels in every release and records when each old file left the build. The step only reads from the live server and has a 20 minute limit. A tab that asks for a file that is gone reloads itself once (`src/lazy-feature.jsx`). `test/release-carry-forward.test.mjs` checks this.
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

# Employee Master is changed only in HR Pulse

Set by the owner on 23 November 2026: "Pulse HR is now the final authority for employee master. All the creation, edit, and delete will only happen from Pulse HR, not from Pulse 2", and of Pulse-II's own doors: "Stop it and switch it off till the time I don't allow from my Telegram."

- Every Pulse-II route that adds or edits an employee answers 423 while the door is closed: Employee Master add, edit and Import CSV / JSON, HR's master Excel Apply, and Employee Current Location Save. The general master routes never write `Employee master` or `ERP Employee master`, open door or not.
- The door opens only when the owner (`EMPLOYEE_DOOR_OWNER_LOGINS`) taps Allow on Telegram, for 30 minutes, and closes by itself. An administrator asks from the Employee Master page with a reason; an open door can be closed at once.
- Not behind the door, because they happen while a batch is made or come from HR: the site move with OTP on a card, the "drives this vehicle" mark on Fetch, and transfers approved in HR. The owner wants these to reach HR Pulse too (two-way); that link is not built yet.
- A new route that adds, edits or deletes an employee must take `door.requireOpen`. `shared/employee-master-door.mjs` holds the rule, `server/routes/employee-master-door.mjs` the lock and the Telegram buttons; `test/employee-master-door.test.mjs` checks it.

# A site move made in Pulse-II is told to HR Pulse

Set by the owner on 23 November 2026: "it should be two-way ... anything which MIS changes during batch creation should get auto updated in HR employee master also", with no second approval in HR Pulse.

- The change the MIS makes to an employee while a batch is made is the site move with an OTP on a card. When it changes the site held today, `applyEmployeeSiteMove` writes one line into `mis_hr_site_move_outbox` in the same transaction; `server/services/hr-site-move-outbox.mjs` sends it to HR Pulse right after the OTP and again every minute until HR Pulse answers. HR Pulse takes a move once, by its id.
- A move that came from HR Pulse (`requestedBy` starting `hr-`) and a move that only fills in history are never sent. Pulse-II never changes a name, designation, category or status in HR Pulse.
- HR Pulse answers "applied" or "held" with a reason; Sync all masters shows the moves still waiting and the held ones.
- An OTP on an old card: when HR's master holds today's site and no dated move was ever made, a card dated before HR's master (`hrSiteSince`) fills in the history only (at the card's site from the card's date, back at HR's site from the day HR's master holds it). Today's site and its lock are not touched. The lock (`siteLockedAt`, `siteLockedBy`) is written only by a move that sets today's site.
- `test/hr-site-move-outbox.test.mjs` checks this.

# Employee Master and Employee Transfer are copied from HR Pulse

Set by the owner on 23 November 2026: "Pulse HR is now the final authority for employee master ... any data entered in Pulse HR should be auto synchronized on minute to minute basis with Pulse 2." It replaces his morning order of the same day ("do not sync Employee Master, sync only Employee Transfer").

- Employee Master is copied from HR Pulse every minute (`server/services/hr-employee-minute-copy.mjs`, rules in `shared/hr-employee-changes.mjs`). Pulse-II asks HR Pulse "what changed after number N?" and applies only those people: details taken, a new person added, LEFT and removed people switched off (never deleted), another site as a dated move from that day. When nothing changed the database is not read.
- It starts only after a person has looked at the Preview of the whole list on Sync all masters and applied it (the line has no Sync button; "Sync all masters" and the hourly run leave it). It stops itself when one minute would switch off more than 50 people, and starts again only after a person applies the Preview again.
- What could put a wrong person on a number is held and nothing changes for it: the number on two lines in HR Pulse, a completely different name, a number that an old line in Pulse-II holds, a site set by an OTP in Pulse-II that HR Pulse does not show yet. An administrator can accept a changed name on Sync all masters; everything else is corrected in HR Pulse.
- One server at a time runs it (a database lock). The release approvers are told on Telegram when it stops, holds a change, or has not copied for 10 minutes (Automation Centre line A27, `hr-employee-copy`).
- Every night from 02:00 in India both whole lists are matched once (`match` in the same service): HR Pulse's people and the people Pulse-II lists at the sites HR Pulse covers. What the minute copy missed is corrected by the same rules and the same stop. A site HR Pulse has no line for (Lalpeth) and the dummy driver IDs are left as they are. The result is shown on Sync all masters ("the same" or what was corrected), told on Telegram only when the lists were not the same, and "Match both lists now" runs it by hand. It does not run on the day the copy is started. `test/hr-employee-nightly-match.test.mjs` checks it.
- Employee Transfer: copied every hour and on Sync, and within a minute when HR approves a new one. An HR-approved transfer moves the worker from the transfer date as an approved move (`applyEmployeeSiteMove`), once per HR transfer (`hr_transfer_sync`). A transfer whose person is not in Employee Master, or whose site is not ours, waits for the hourly run.
- HR serves the data read only at `/api/integrations/mis/employees`, `/employee-changes?after=N` and `/transfers` (caliber-hr repo `server/mis-employee-sync.mjs`). Pulse-II's Azure setting `HR_SYNC_KEY` must equal HR's `MIS_SYNC_KEY`. `HR_SYNC_SCHEDULE=0` stops both timers.
- Employee Master is never copied from Oracle / ERP. `test/hr-employee-minute-copy.test.mjs` and `test/hr-employee-sync.test.mjs` check this.

# No temperature sign

Set by the owner on 23 November 2026: "remove the temperature sign from all the websites. I don't require that."

- No page shows the outside temperature: not the top bar, not the Help & Training window. The same was removed from Pulse and HR Pulse.
- The screen calls no weather service. Do not add the chip, its hook or a weather call back unless the owner asks.
- The site coordinates the chip used are kept in `src/site-coordinates.mjs`, because the sign-in location names the nearest site from them.
- `test/no-temperature-chip.test.mjs` checks this.

# Attendance from every trip card, scanned or manual

Set by the owner on 24 November 2026: "attendance should mark whether any process is done through scan or manual entry", and a manual card on 12 Hrs with Day / Night shift must count the punch and mark attendance.

- Every saved VLB, ELB and LMV card with an employee is a duty in the shift it names, whether it was scanned or entered by hand, and counts as present (Attendance Batch-wise / Month-wise, the HR feed, the biometric punch check).
- The duty's shift is read by `cardDutyShift` (`shared/duty-shift.mjs`): a Day or Night (12-hour) choice on the card wins over the batch's 8-hour label (a "Day, 12 Hrs" ELB in a Shift I batch is a Day duty). Only Day and Night together, or two different Shift I / II / III labels, are a conflict.
- Shift and Shift Hrs are mandatory on the ELB Manual machine entry: both start blank, the user picks the batch shift, Day or Night, and 8 or 12 Hrs; Day and Night take 12 Hrs. The server refuses a save without them (`manualEntryShiftIssue` in `server/rules/vlb-batch-stages.mjs`). Jayant keeps its Shift Master hours.
- A manual LMV card needs a shift (Shift Master entry, Day / Night or the card's marked shift); a manual VLB or ELB marked Day / Night needs 12 Hrs (`normalizeLogBook`).
- Caliber ID Re-check also lists every card (VLB, ELB, LMV, scanned or manual) that marks no attendance although its driver stands: no driver on a card that shows work, an Employee ID and Caliber ID naming different people (both fixed by Submit), or no shift / two shifts (fixed by **Save shift** on the line, `POST /api/caliber-recheck/shift`, which writes every shift label to agree and keeps the old ones in `shiftCorrection`). Rule: `attendanceGap` in `shared/caliber-recheck.mjs`.
- Do not remove these rules; `test/duty-shift.test.mjs` and `test/caliber-recheck.test.mjs` check them.

# Caliber Punch Re-check

Set by the owner on 24 November 2026: "caliber punch recheck mis me hi, caliber id recheck ke niche", so that a VLB, ELB or LMV card error that keeps a punched person's attendance out is put right from the same screen.

- Masters › Caliber Punch Re-check sits under Caliber ID Re-check and is open to the same people (the card makers and whoever keeps Employee Master, i.e. HR), each for the sites of their login.
- `GET /api/caliber-recheck/punches` (one day at a time) reads the punches (site machines from HR Pulse, and the imported ones), judges the cards of the day as Caliber ID Re-check does, and lists every driver or operator who punched, has no card that counts, and has a card with an error at the site of the punch on that date. Helpers and staff are left out. A failed HR Pulse read is said and the imported punches are still used.
- Two views (owner, 24 Nov 2026: "make this for trip card punch (VLB, ELB & LMV)", "dono rakho"): **Trip cards** first, from every saved VLB, ELB and LMV card (`GET /api/caliber-recheck/cards`, rule `shared/caliber-card-recheck.mjs`, screen `src/caliber-card-recheck.jsx`): per site VLB, ELB, LMV, all cards, attendance marked, card error (fixed on the line as on Caliber ID Re-check), attendance with and without a bio-punch, and idle cards with nobody; every figure drills down. Every card line has the correction box (owner, 24 Nov 2026: "correction section not showing"): a card with an error as on Caliber ID Re-check, any other card takes another driver from the paper card (`/pick` with `anyCard`, recorded as "Changed on Trip cards (driver stood)", Undo puts the earlier person back); Caliber ID Re-check itself still changes only listed cards. **Bio-punch** beside it is the view below, from the punches.
- Step 1 also shows the punches received per site before the driver filter and those whose ID is in no employee list, and the page names the sites HR Pulse sent machine punches for, so a site whose machine does not send is plain (owner, 24 Nov 2026).
- Every Step 1 figure drills down (owner, 24 Nov 2026: "make it drill down for all"): punched, attendance from a card (with that card), to fix, and punched with no card. Every site of the login has a line, 0 when its machine sent no punch ("not able to see all sites").
- Step 3 sets each person beside those cards, their own card first. Submit puts the person on the chosen card (`/pick`), Save shift writes the shift of their own card (`/shift`), Refresh asks HR Pulse about their ID; Undo takes a Submit back. Nothing new writes a card: it is the Caliber ID Re-check routes.
- Rule: `shared/caliber-punch-recheck.mjs`; screen: `src/caliber-punch-recheck.jsx`; `test/caliber-punch-recheck.test.mjs` checks it.

# A card's machine must fit its book's category in Equipment Master

Set by the owner on 24 November 2026: if any vehicle or equipment on a VLB, ELB or LMV card, scanned or entered by hand, does not match its category in the master, show an error.

- A VLB takes only a machine whose Equipment category in Equipment Master is Vehicle, an ELB only Equipment, an LMV only LMV. An LMV is no longer accepted on a VLB or ELB (it was from 9 Nov 2026). The save refuses any other machine, naming the machine, its category and the right book (`bookCategoryIssue` in `shared/equipment-kind.mjs`, called from `resolveLogBookData` for manual and scanned cards). The door lists offer only the machines that fit.
- A trip's loading machine must be Equipment in the master, whatever its group says (`shared/trip-equipment-validation.mjs`).
- A machine with no category in the master is still judged by its group, and the error says to set its category in Pulse.
- Scan review shows the same error on the door field before saving (`src/scan-field-review.mjs`).
- Masters › Machine Category Re-check, under Caliber Punch Re-check, for the same people: the saved cards whose machine or trip loading machine does not fit the master today, in Step 1 / 2 / 3. It is read only, so the card is corrected on its own page or the category in Pulse (`GET /api/caliber-recheck/machines`, rule `shared/machine-category-recheck.mjs`).
- `test/machine-category-check.test.mjs` checks this.

# VLB, LMV and ELB locking off for five days

Set by the owner on 24 November 2026: "locking of VLB, LMB and ELB ka lock hata sakta hu kya 5 din ke liye".
Extended by the owner on 25 November 2026 to the end of 1 Dec 2026, the same day the multi-day batch window ends.

- Until the end of 1 Dec 2026 (India time) a batch's stages stop nobody: VLB, LMV and ELB cards are added and changed in every open stage (VLB open, LMV open, ELB open), by hand or by scan. A VLB card changed after Lock VLB updates the batch's machine trips at once; a machine no card loads any more drops to 0 trips.
- No batch waits for an older batch of the site to lock LMV or close. Close batch is offered in every open stage and does Lock VLB and Lock LMV itself, with their checks; everything a close checks (an ELB for every loading machine, transfers, waiting scans, duplicate ELBs) is unchanged.
- Not changed: a closed batch is reopened before its cards change. (Until 1 Dec 2026 several shifts of one date may be open together; see the multi-day batches section.) Deleting a card outside its open stage still goes through Deletion.
- The batch page says so ("Locking is off until …"). From 2 Dec 2026 00:00 IST the locks return by themselves; nothing has to be switched back.
- The Azure setting `VLB_BATCH_LOCK_PAUSE_UNTIL=YYYY-MM-DD` moves the last day, `VLB_BATCH_LOCK_PAUSE_UNTIL=off` ends the pause at once (a setting change restarts the app, no release).
- `shared/batch-lock-pause.mjs` holds the rule; `test/batch-lock-pause.test.mjs` checks it.

# VTC Training is present, in its own colour

Set by the owner on 25 November 2026: "TRAINING VTC ka option alag colour me do aur use present dikhao", and "ise 0 trip ke sath mat jodo".

- VLB and ELB Manual have a **VTC Training** button beside **Present — 0 trips**. Its form takes the site, **From date and To date** (no shift, owner 25 Nov 2026: "from date to date ... and remove shift"), the driver or operator, and where the training was held (required). One save marks every day of the range present: at most 31 days, from 1 Nov 2026 up to today (India), all saved or none (`POST /api/training-attendance`, the same people and site checks as Present — 0 trips). A training day has no shift of its own; each day is kept once in Shift A (`TRAINING_SHIFT`), so attendance shows it P1, purple, and counts the person present once that day.
- Several people in one save (owner, 25 Nov 2026: bulk): the form lists the drivers or operators of the site with a search and a tick for each, and "Select all shown"; up to 100 people. Every ticked person is marked present on every day of the range, in one statement; if any one of them is not of this site nothing is saved and the screen says how many to remove (`src/vtc-training-people.jsx`).
- It is kept in `mis_shift_attendance` with the reason `VTC Training`, so Attendance Batch-wise / Month-wise, the HR feed and the sheet checks count it as present (P). It is drawn purple ("VTC Training (present)"), has no trips, its source is `training`, and it is never listed or counted as a zero-trip entry (not in a batch's Present — 0 trips list, not in the zero-trip reasons).
- One person has one entry per date, site and shift: saving a training day again replaces it (never doubles it), and VTC Training replaces a Present — 0 trips of Shift A that day. A saved card of that shift goes first. Like every duty, it shows in Attendance once the site's day is locked.
- A training day on which the person also has any duty (a VLB, ELB or LMV card or a Present — 0 trips, any shift, any site) counts as one present, that duty; the training entry of that day is left out (owner, 25 Nov 2026: "if that driver or operator has done any shift on that particular day ... it should consider as single present"). Only a training day with no other duty shows purple.
- `shared/vtc-training.mjs` holds the rule; `test/vtc-training.test.mjs` checks it.

# Batches for several days open together for seven days

Set by the owner on 25 November 2026: "I need to open multiple batch for multiple days....fix it for 7 days".

- Until the end of 1 Dec 2026 (India time) a site can have batches of several report dates open at once: an open batch of an earlier date no longer stops a later date ("Fully close … first"), the shift-order rule (the shift before must exist with VLB locked) is off, and no batch waits for an older batch to lock LMV or close.
- Several shifts of the same date open together too (owner, 25 Nov 2026: "allow multiple shifts of same date open too"): no Lock VLB first; Unlock VLB and reopen are not stopped by another open batch. The database index `mis_vlb_one_open_vlb_per_site_date` is dropped at start while the window runs and comes back at a start after it, only if no site and date still has two VLB-open batches.
- Still kept: one batch per site, date and shift.
- From 2 Dec 2026 00:00 IST the old rules return by themselves. The Azure setting `VLB_MULTI_DAY_BATCHES_UNTIL=YYYY-MM-DD` moves the last day, `=off` ends it at once.
- `shared/multi-day-batches.mjs` holds the rule; `test/multi-day-batches.test.mjs` checks it.

# Every VLB, ELB and LMV machine of the site needs an answer

Set by the owner on 25 November 2026: when VLB, ELB and LMV close, the MIS user fills in every machine of the site: 100 VLB means every vehicle has a log book card, or its maintenance from Pulse-1, or an idle / 0 trip reason; the same for every ELB and LMV.

- Part 1: the batch page shows the **Machine muster** at its top, above the stage notes and entry buttons, from the moment the batch is made until it closes: a title with each book's tally ("VLB 47/114 · ELB 0/38 · LMV 0/16"), then **Step 1 · Machine coverage** per book (VLB, ELB, LMV): machines at the site (active, by Equipment category), how many are answered by card, by Pulse-1 or by a reason, how many have no answer, and cards of machines from another site. Pressing a figure opens **Step 2** with those machines; the page opens on Step 2 · No answer yet of the first book with machines still to answer (VLB, then LMV, then ELB). An ELB saved with a status on the fleet list (breakdown, maintenance, no operator…) counts as answered.
- The muster is kept with the batch when it is made (`mis_batch_machine_roster`; a batch made before this is kept at its first read while open): a machine the master moves away during the shift stays on it and can be answered ("Transferred out / at another site"), a machine added later is not on it unless a card of the batch names it. The ELB book follows the ELB fleet list once VLB is locked, as before.
- Owner's choice, 25 Nov 2026: a machine is cleared **by itself** (a card, or a whole-shift breakdown or idle in Pulse-1); nobody ticks the cleared ones.
- Part 2 (owner, 25 Nov 2026: "if any vehicle or equipment is in maintenance or idle it should fetch from pulse.cmll.in"): what Pulse-1 holds for the batch's date, site and shift is read by itself for every VLB and LMV machine, from Pulse-II's copy of Pulse's breakdown list (refreshed every minute; `shared/pulse-shift-status.mjs`, matched as a card's BD hours are). A breakdown / maintenance covering the whole shift, or a vehicle-idle request (with its idle reason), answers the machine; a part-shift breakdown means it also worked, so it still wants a card. Step 2 shows a **Pulse-1 (this shift)** column for every machine. There is no Fetch button. The page, Lock VLB, Lock LMV and Close read the copy before the batch lock, for at most 5 s; when it cannot be read the page says so and Pulse-1 answers nothing until it is read again.
- A machine with no card and nothing in Pulse-1 takes an **idle reason** by hand in Step 2 (batch owner, MIS user or MIS administrator, batch open): No operator, Not in use, No work, Standby, or Transferred out / at another site, each with a written reason. Many machines take one reason at once: tick them (or "Select all … with no answer"), choose the reason, **Save for N selected** (`PUT …/machines/answers`, up to 500, all or none; a machine not on the batch's muster in that book stops the save). **Clear** removes a reason. Order: a card wins, then a reason by hand, then Pulse-1. One answer per batch and machine (`mis_batch_machine_answers`, `server/rules/batch-machine-answers.mjs`); every save and clear writes a batch audit line. An ELB machine is still answered on the ELB fleet list, which takes its BD hours from Pulse-1.
- Part 3, the stop: from 2 Dec 2026 00:00 IST (after the lock pause and multi-day batches end), for a batch whose report date is 2 Dec 2026 or later, **Lock VLB** waits until every VLB machine has an answer, **Lock LMV** every LMV machine, and **Close batch** every VLB, ELB and LMV machine (an ELB machine: its ELB saved on the fleet list with a status). The refusal names the machines with no answer. Batches of earlier dates close as before. Until then the page only warns ("Warning only, nothing is stopped yet. From 02-12-2026 …"); once the stop applies the line is red.
- The Azure setting `BATCH_COVERAGE_STOP_FROM=YYYY-MM-DD` moves the first day; `=off` keeps it a warning (a setting change restarts the app, no release).
- `shared/batch-fleet-coverage.mjs` holds the rule, `shared/pulse-shift-status.mjs` the Pulse-1 read, `shared/batch-coverage-stop.mjs` the stop, `src/batch-fleet-coverage.jsx` the panel; `test/batch-fleet-coverage.test.mjs` and `test/batch-coverage-stop.test.mjs` check it. Older tests that lock or close batches on later dates set `BATCH_COVERAGE_STOP_FROM='off'` themselves.

# Machine Roster

Set by the owner on 25 November 2026: a vehicle and equipment roster, site-wise machine list.

- Masters › Machine Roster, after Equipment master, for the same people as Caliber ID Re-check, each for the sites of their login. Read only: a machine is moved or changed in Pulse.
- **Step 1** one line per site: active VLB (Vehicle), ELB (Equipment) and LMV machines in the Equipment Master, all active, category not set (judged by group) and not active. Every figure opens **Step 2** under it with those machines (door, registration, book, name, category, group, make · model, status). The roster has no dates, so it has no date by shift step.
- The figures use the same rules as the batch page's machine coverage (`siteRoster` in `shared/batch-fleet-coverage.mjs`), so they are the machines a batch of the site has to answer for.
- `GET /api/caliber-recheck/roster`; rule `shared/machine-roster.mjs`, screen `src/machine-roster.jsx`; `test/machine-roster.test.mjs` checks it.

# HR's corrected attendance reaches the biometric mismatch

Set by the owner on 25 November 2026: a day an HR administrator corrects on HR Pulse's Attendance roster › Manual Biometric must show in Pulse-II's Biometric vs trip card mismatch too.

- HR Pulse sends its corrected days beside the machine punches (`corrections` in caliber-hr `server/mis-biometric-punches.mjs`). Pulse-II's `machineDays` (`shared/trip-biometric-check.mjs`) puts the corrected In / Out in place of that day's punches; an Out not after the In is the next morning, and a next-date duty that starts within 3 hours of it is the same night. A, WO, H, CO or L leave no biometric day; P, HD or OD with no time is present and not a miss punch. Imported punches of that day never undo the correction. The line says "corrected in HR" with who and why.
- HR Pulse is asked from the day before the first date (`server/services/hr-machine-punches.mjs`), so a night duty that began that evening is read whole and its morning Out is not a day of the first date. With 31 dates asked, the day before is a second small read.
- Used by Attendance Sheet Mismatch, Caliber Punch Re-check and the attendance "card + punch" read. `test/hr-punch-corrections.test.mjs` checks this.

# Attendance Sheet Mismatch: HR sheet vs Biometric

Set by the owner on 25 November 2026: the attendance Excel HR makes by hand is uploaded and checked against the biometric HR Pulse holds, the same process as Site Sheet vs Trip Card.

- The tab has two buttons: **HR sheet vs Biometric** (opens first) and **Trip card vs Biometric** (the earlier check, unchanged).
- 1 · the HR Excel (EMP. ID, NAME, DESIGNATION, one column per date, read as the site sheet is), 2 · the biometric: the punches Pulse-II holds (HR Pulse machine punches with HR's corrections, and the imported ones) or a device file uploaded there, 3 · the site and Check. The dates are the sheet's marked dates up to today, at most 31.
- Everyone on the sheet is compared, staff and helpers too. P with a full punch (or a day HR marked present) is the same; P with only IN or OUT is a miss punch; P with a punch only at another site, and P with no punch, are mismatches; A, WO, L, CO, H, - or blank with no punch is the same, with a punch at this site it is "Punch, HR sheet not P". A mark not understood is not compared. Trip cards are shown beside a day, never counted.
- Also listed: EMP. ID and name to correct, and people who punched at the site and are not on the sheet. The Excel gives the HR sheet back coloured, with these lists.
- Rule: `shared/hr-sheet-biometric.mjs`; run: `src/hr-sheet-biometric-run.mjs`; screen: `src/hr-sheet-biometric.jsx`; `test/hr-sheet-biometric.test.mjs` checks it. Nothing is changed in Pulse-II.
