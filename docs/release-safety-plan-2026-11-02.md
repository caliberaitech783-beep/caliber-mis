# Release safety: an operator's work survives any crash, refresh or update

Date: 2 November 2026. Platform: Caliber Pulse-II (MIS), Trip Cards · Scan & Review (VLB), ELB.

## 1. What happened at 17:29

Anoop uploaded 40 Jayant cards on the live site. While the equipment review dialog was open for card 32, the screen was replaced by "This screen could not be displayed". After Refresh, the VLB page opened at "Select site"; selecting Jayant OC showed batch B03 with 0/0 cards. The 40 cards were still on the server, but nothing on screen could reopen the entry they were in.

Three separate faults lined up:

| Fault | Where | Effect |
|---|---|---|
| A JavaScript error while drawing the screen | browser, PR 40 build (live since 17:09) | Whole screen replaced by the error card. The exact error was written only to the browser console, which nobody saw, so it could not be diagnosed afterwards. |
| Re-selecting the VLB batch wipes the entry from the address | `src/vlb-entry-workspace.jsx` | After a refresh the scan page has no entry id, so it opens empty. |
| The scan page shows no list of entries | `src/bulk-card-scanning.jsx` | The operator cannot reopen an existing entry; only the address bar could. |

Context: there is one Pulse-II deployment. Every merge to `main` builds, tests and deploys to production in about 13 minutes and restarts the app for about 4 minutes. Five releases went live between 16:28 and 17:38 while cards were being scanned; a sixth followed at 17:57. There is no second environment, so "test platform first" in earlier plans was never possible.

## 2. The guarantee this plan gives

Cards and corrections live on the server from the moment they are uploaded or edited. The browser only displays them. So the guarantee is: **whatever happens in the browser or on the server, the operator can get back to the same entry, with the same cards, by reopening the page.** With 7 sites and 3 shifts there is no quiet hour, so the system is built to be updated at any hour rather than scheduled around shifts.

## 3. What is built (this release)

| # | Protection | Where | Behaviour |
|---|---|---|---|
| 1 | Browser errors reach the server | `client-error-report.mjs`, `src/client-error-report.mjs`, `src/lazy-feature.jsx`, `src/main.jsx` | Every render error, window error and unhandled promise rejection posts to `POST /api/client-errors` with message, stacks, screen, address, UI version and user. It is written to the server log (Azure log stream) and kept 90 days in `mis_client_errors`; administrators read it at `GET /api/client-errors`. Rate-limited to 20 per user per minute; a page sends at most 25. |
| 2 | The entry reopens on its own | `src/scan-entry-recovery.mjs`, `src/bulk-card-scanning.jsx` | With no entry in the address, the scan page reopens the entry this browser last worked in for the VLB batch (remembered per batch in local storage), otherwise the newest entry with unsaved cards. Cancelled entries never reopen. |
| 3 | The entries are listed | `src/bulk-card-scanning.jsx` | "Scan entries for this batch" shows every entry for the batch's date, site and shift with cards, saved, unsaved and skipped counts; one click opens it. |
| 4 | Refresh keeps the place | `src/vlb-entry-workspace.jsx` | Re-selecting the same VLB batch (which is what a refresh does) keeps entry, card and view in the address. They are cleared only when the operator moves to another batch. |
| 5 | A crash is contained | `src/lazy-feature.jsx`, `src/bulk-card-scanning.jsx` | The equipment review dialog, the duplicates list and the batch report each have their own boundary. If one fails, that panel shows "could not be displayed", with Close and Refresh, and the rest of the screen keeps working. A panel recovers by itself when its card or entry changes. |
| 6 | Uploads survive a restart | `src/scan-upload-retry.mjs`, `src/bulk-card-scanning.jsx` | A card upload that fails because the server is restarting is sent again after 1, 2, 3, 5, 8 and 13 seconds. The server keys every card on the browser's upload key, so a repeat never creates a second card. Read-only polling already retried through restarts. |
| 7 | Server responses are checked | `src/bulk-card-scanning.jsx` | A response without `cards` or `duplicates` (an older or newer server during a deployment) is treated as empty instead of crashing the page. |
| 8 | Content-duplicate rejection is off | `scan-duplicates.mjs`, `bulk-card-scanning.mjs`, `.env.example` | A read card that matches another entry by date, door and card number is **named on the card for review**, not moved out of the entry, until `SCAN_DUPLICATE_CONTENT_REJECT=true`. Both duplicate flags are shown on `/api/health` so their state is verifiable, not assumed. |

Existing protections that stay: the "Update available, refresh when ready" banner (`src/site-update-notice.jsx`) keeps the batch, card and session across the refresh; read-only API calls retry through gateway 502/503/504 (`src/api-transient-retry.mjs`); draft corrections are cached per card revision (`scan-draft-cache.mjs`).

## 4. Operating rules

1. **`main` is live.** A merge is a production release, not a staging step. Nothing is merged that has not passed the full test suite and the release smoke test below.
   Since 2 November 18:40 this is enforced by GitHub branch protection on `main`: changes arrive only through a pull request, the `build` and `logbook-layout` checks must pass on a branch that is up to date with `main`, administrators are not exempt, and force pushes and deletions are refused. A pull request that falls behind `main` is updated (`gh pr update-branch`) and re-checked before it can merge. Documentation-only merges (`docs/`, `*.md`) do not trigger a release, so they never restart the live app.
2. **New behaviour ships off.** Anything that changes what an operator sees on the card board goes behind a flag that defaults off in production. The flag's state is visible on `/api/health`.
3. **Release smoke test, every release, ten minutes:** upload one real PDF; open the equipment review dialog; press F5; confirm the same entry, cards and card reopen; open `/api/health` and confirm `commit` and the flags; open `GET /api/client-errors` and confirm nothing new.
4. **Operators are told.** A release restarts the app for about 4 minutes. During that window uploads pause and resume on their own; the operator sees "Server busy or restarting · card N will be sent again". Nobody needs to stop work, but the WhatsApp group is told before and after.
5. **Diagnose from the server.** When an operator reports a blank panel, the first stop is `GET /api/client-errors` (or the Azure log line "Browser error (render) for <login> …"), not a screen recording.

## 5. Still open

- **A real test platform.** A second Azure web app and PostgreSQL database restored from backup, with `main` deploying there and production deploying from a tag after sign-off. This needs Azure subscription access that the build machine does not have. Until it exists, rules 1 to 3 are the only gate.
- ~~**Direct pushes to `main`.**~~ Closed 2 November 18:40: branch protection now requires a pull request with passing checks (see rule 1). The 17:57 and 18:21 releases were direct pushes; the next attempt is refused by GitHub.
- **The 17:29 error itself** is not identified. If it recurs, protection 1 names it within minutes.

## 6. Release procedure with the test platform (added 2 November 2026, evening)

This section closes the first open item of section 5. `docs/test-platform-setup.md` is the runbook that creates the test platform (a second Azure web app and PostgreSQL server restored from a live backup, with every notification path switched off). Once it has been executed, the workflows in `.github/workflows/` give this release path, and rule 1 of section 4 changes to: **`main` is the test platform; a `release-*` tag plus the owner's approval is live.** Branch protection on `main` stays as it is.

| Step | Who | What happens |
|---|---|---|
| 1. Merge to `main` | Developer, through a pull request with green `build` and `logbook-layout` checks | `Build, test and deploy to the Pulse-II test platform` runs: build, full test suite, release identity and runtime checks, deployment to the test app, health check of the test address for the merged commit with `scheduledJobsEnabled: false`. About 13 minutes. Documentation-only merges do not release. |
| 2. Smoke test on the test site | Operator or developer, ten minutes | The checklist of section 4 rule 3, on the test address: upload one real PDF, open the equipment review dialog, press F5, confirm the same entry, cards and card reopen, open `/api/health` and confirm `commit` and the flags, open `GET /api/client-errors` and confirm nothing new. Note the `commit` value. |
| 3. Tag the tested commit | Owner | The tag names the exact commit the test site served (step 2), never a branch name. |
| 4. Approve the production run | Owner, in GitHub | The production workflow starts from the tag and waits in the `production` environment. GitHub shows **Review deployments** on the run; approve it. The workflow first confirms the environment still requires a reviewer and that the commit is on `main`, then builds, tests and deploys to `caliber-mis-783`. About 13 minutes, with the 4-minute restart of rule 4: tell the WhatsApp group before and after. |
| 5. Health check | Owner | The workflow verifies `https://pulse-ll.cmll.in/api/health` reports the tagged commit and that the served JavaScript matches. Then the smoke test of step 2 on the live site, and `GET /api/client-errors`. |

Tag names are `release-YYYY-MM-DD-N`, N counting from 1 within the day. The exact commands, run from a checkout of the repository (the commit is the forty-character value that `/api/health` on the test site shows):

```bash
git fetch origin main --tags
```

```bash
git tag release-2026-11-03-1 <commit from the test site's /api/health>
```

```bash
git push origin release-2026-11-03-1
```

A plain (lightweight) tag is enough; an annotated tag also works because the workflow reads the commit from the checkout. If `git push` is refused because the tag exists, the day's counter is already used: pick the next N.

Rollback: tag the previous good commit as the next `release-…-N` and approve it; the test platform is not involved, because that commit has already been live. Emergency release without the test platform: **Actions → Release Pulse-II to production → Run workflow**, choose the `main` branch, give the reason; the same approval is required and the reason is kept with the run. Both are exceptions to be written into this document's history, not routine.

What the gate guarantees: production cannot change through a merge, a direct push (refused by branch protection) or a tag alone. A production run that was not approved by the owner stops at its first step, and a tag that points at a commit outside `main` is refused. The test app and the live app have different Azure identities, different GitHub secrets and different concurrency groups, so a test release can neither reach the live app nor delay a live release.
