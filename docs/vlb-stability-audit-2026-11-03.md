# VLB stability audit: why every change brings a new error, and the plan to stop it

Date: 3 November 2026. Scope: Trip Cards · Scan & Review (VLB), ELB, and the way changes reach pulse-ll.cmll.in.

## 1. What the numbers say

| Measure (1–2 November 2026) | Value |
|---|---|
| Commits on the repository | 147 (63 of them merges) |
| Pull requests merged | 30, of which 19 touched the VLB scan or review flow |
| Production releases on 2 November | at least 7 (every merge to `main` deployed and restarted the live app) |
| Edits to `src/bulk-card-scanning.jsx` (the scan page) | 36 commits in two days |
| Authors writing to the same files in parallel | 4 identities (two Claude sessions, Codex, Caliber-tech) plus 6 local worktrees |
| Commits whose only purpose was to repair an earlier commit | 16 (meterLimitIssues crash, lost SQL placeholders, dropped checkbox, fixture stubs, test anchors, a reverted feature, a menu "absorbed from another branch") |
| Size of the scan page source | 333 lines, 92,500 characters: average 277 characters per line, longest line 6,389 characters |
| Size of the main UI file / server file | `src/main.jsx` 12,176 lines; `server.mjs` 8,801 lines |
| Tests that assert on the source text of `src/main.jsx` | 282 of 736 test files |
| Tests that build a component with `new Function` and a stubbed scope | 133 |
| Tests that render through React | 48 |

## 2. The five root causes

### 2.1 Production was the only test platform

Until 16:39 on 2 November every merge to `main` built, tested and deployed straight to pulse-ll.cmll.in, restarting the app for about four minutes each time. Thirty merges in one day meant operators were working on a site that changed under them several times an hour. Every defect that the test suite did not catch was found by Anoop or Nitish on real cards. That is why each fix "brought another error": the next release was the first time anyone exercised the code.

PR 50 moved `main` to a test platform and gated production behind a `release-*` tag, but the test platform itself does not exist yet: the `Build, test and deploy to the Pulse-II test platform` run at 16:39 failed on the guard that refuses to deploy without `PULSE_TEST_WEBAPP_NAME`, and the 18:41 run has been "in progress" for hours waiting on the `test` environment. Meanwhile:

- Production is on commit `c9c95c0` (PR 60).
- PR 61 (server judges automatic saving with the same master lists as the browser; the "Extraction needs checking" checkbox restored) is merged to `main` but **not live**, because no release tag has been pushed.
- So the two refusals operators saw yesterday afternoon are still happening on the live site today.

### 2.2 Parallel agents editing one dense file, merged by hand

The scan page is written as a few hundred lines that are each a paragraph of code; the test harnesses patch it with string replacement on exact anchors such as `const fleetCards=cards.filter`. Three failure patterns followed directly from that:

1. **A rewrite of one long line silently drops a sibling.** The Scania door fix on 29 October (`af4e85b`, 4 changed lines) rewrote the review-page line that held the extraction-issues checkbox and lost it. Nobody saw it for four days, until every recovered card was refused with "Card still needs attention".
2. **A refactor removes a definition but not every use.** The meter-rule refactor on 1 November (`09401a5`) removed `meterLimitIssues`; two uses in the Total KMR/HMR labels stayed. Every card opened in review crashed for a day. Vite does not check free identifiers, and the page tests only rendered the overview.
3. **Merges mix branches.** PR 56 carried a right-click menu "absorbed from another branch" and had to be stripped out again (`c4752bb`). SQL placeholders (`$1`) and `\d` were stripped when another session pasted routes through a shell heredoc (PR 37, fixed in PR 39).

Six worktrees under `.claude/worktrees` and 29 unmerged remote branches show how many parallel lines of work exist against one file.

### 2.3 The test suite is large but mostly reads source text

736 test files sound like good cover. But 282 of them open `src/main.jsx` as a string and assert that a fragment or regex is present, and 133 build a component by evaluating the source inside `new Function` with a hand-stubbed scope. These tests:

- **Break on every refactor** even when behaviour is unchanged: 11 commits in two days did nothing but move a "test anchor", stub a new import or realign a fixture (for example `d65b985`, `0daf00b`, `4503f01`, `91ad05c`, `b0f30a9`, `4e8bfae`). Half of yesterday's PRs needed a follow-up commit to the tests before CI went green.
- **Do not fail on a real crash**, because a stubbed scope hides a missing import or a free identifier. The ReferenceError that broke review for a day passed all of them.
- **Take the whole day's test budget** (the suite plus the Playwright layout job) without exercising the path operators use: open a batch, open a card, correct it, save, see it move tiles.

A full local run of `npm test` on this Windows checkout (3 November, 2 minutes 45 seconds) passes every VLB test and fails only three environment-bound tests (an Azure settings check that needs `python3`, a release-packaging test that needs symlink rights, and the startup gate that cannot remove a busy temp folder). So the suite is green where it matters and the defects of 2 November all passed it: the suite's shape, not its size, is the problem.

The one structural guard added yesterday (`test/ui-undefined-names.test.mjs`, the TypeScript "Cannot find name" check) is the kind of test that would have caught 2.2 item 2.

### 2.4 Browser and server judge the same card with different inputs

Automatic saving is decided twice: in the browser (`canAutoSaveScanCard` with the master lists loaded) and again on the server before writing. Until PR 61 the server ran the same function without the Equipment, Shift and Employee masters, so a card the browser showed as ready was refused with 409 "machine-summary conflict" on every trip row, and the operator opened the card to find nothing to correct. The same split caused "24 saved · 13 unsaved" in the chip while the tile said 35/37 (PR 58): two counters computed from different data.

Any rule that lives in two places with two sets of inputs will drift again the next time a master or a rule changes.

### 2.5 New behaviour shipped on, not behind a flag

The operating rule in `docs/release-safety-plan-2026-11-02.md` says anything that changes the card board ships off. Yesterday the equipment aliases, the batch-final header, the right-click reject menu, the once-per-card prompts and the fleet dialog changes all shipped on. Only duplicates (`SCAN_DUPLICATE_*`), the two-stage batch (`VLB_TWO_STAGE_BATCHES`) and the alias OTP (`EQUIPMENT_ALIAS_OTP`) are flagged. When an unflagged change misbehaves the only remedy is another release, which is the loop you are in.

## 3. The plan

Ordered by what stops the bleeding first. Steps 1–3 are for today; 4–6 for this week; 7 is ongoing policy.

### Step 1 (today, 1 hour): get the stranded fixes to operators and stop the half-migrated pipeline

1. Decide one of two routes for PR 61, which is on `main` but not live:
   - **Preferred:** finish sections 1 and 6–7 of `docs/test-platform-setup.md` (production environment with you as required reviewer; test web app name and secrets), let the 18:41 test-platform run complete, smoke-test, then tag `release-2026-11-03-1` on commit `cf3769d` and approve the production run.
   - **Fallback if the test platform cannot be provisioned today:** run `Release Pulse-II to production` manually (workflow_dispatch with a reason) from `cf3769d`, after the ten-minute smoke test of the release plan, section 4 rule 3, on a local build.
2. Cancel the two 18:41 runs that are "in progress" with no progress so the checks on `main` reflect reality.
3. Freeze merges to `main` for VLB until step 2 is in place. Everything else below happens on branches.

### Step 2 (today, 2 hours): one structural gate per failure class

Add to `npm test` (they run in CI already through `npm test`), each targeted at one failure pattern from section 2:

| Failure | Gate |
|---|---|
| Free identifier after a refactor | Already in place: `ui-undefined-names.test.mjs`. Extend the same tsc run to `*.mjs` at the repository root (server modules), not only `src/`. |
| Lost `$1` placeholders / `\d` after a paste | A test that loads every root `*.mjs`, finds `query(` / `sql` template strings containing `WHERE … =` with no `$n` and no template interpolation, and fails. Cheap, catches PR 37's class. |
| Dropped JSX sibling in a long line | A rendering test of the review card form that asserts the presence of each **operator-visible control by its label** (Back to card status, Extraction needs checking, Save, Reject, Recheck, Delete, Review highlighted card). This is a behaviour test, not a source regex. |
| Browser/server drift on auto-save | A single test that runs `canAutoSaveScanCard` through the server route **and** the browser call for the same fixture card and master lists and asserts both answers match. |

### Step 3 (this week, 1 day): make the scan page safe to edit

1. **Reformat `src/bulk-card-scanning.jsx` and `bulk-card-scanning.mjs`** with a formatter (one statement per line, 100–120 columns). This is a pure whitespace commit, merged alone, with every other VLB branch rebased on it afterwards. It removes the "rewrite one line, lose a sibling" failure and makes diffs reviewable. Existing source-regex tests that break are converted in step 4, not patched.
2. **Split the page by responsibility** into: upload panel, card status tiles, review card form, autosave loop, dialogs. Each piece becomes its own `.jsx` with explicit props, so a merge conflict is confined to one area and a test can render one piece.
3. **One autosave judge.** Move the rule, the inputs it needs (card, batch kind, masters) and the refusal text into one module that both the browser and the server route import. The server route loads the masters once per batch, as PR 61 began.

### Step 4 (this week, 1–2 days): turn source-text tests into behaviour tests, starting with VLB

Do not try to convert all 282 at once. Convert the VLB ones (13 read the scan page, about 40 read VLB parts of `main.jsx`):

- Replace `source.includes('...')` assertions with a render (React test renderer or `renderToStaticMarkup`) and a query by label or role.
- Replace `new Function` harnesses with ordinary imports of the split components from step 3.
- Delete tests that only check that a string exists in source; they are maintenance cost without protection.

Keep the Playwright layout job; add to it the ten-minute smoke sequence from the release plan (upload a PDF, open the review dialog, press F5, reopen the same card, open `/api/health`), running against the test platform after every deploy there.

### Step 5 (this week): one writer per file, and merges that nobody resolves by hand

1. **One branch at a time touches the scan page.** Codex, Claude and Caliber-tech can work in parallel on separate files, but a second branch on `bulk-card-scanning.jsx` waits for the first to merge and then rebases. After step 3 the file is five files, so the constraint bites less.
2. **Every PR that touches VLB gets a review by a session that did not write it**, with two mandatory checks: the added lines carry every `$n`, `\d` and import they claim; and the ten-minute smoke test was run on a local build. This is already in your memory as a rule after PR 37; make it a PR template checkbox.
3. **No code through shell-quoted heredocs or `bash -c` strings**. Writes go through the editor tools. (Memory: `no-sql-through-bash-quoted-scripts`.)
4. Delete merged remote branches and stale worktrees weekly; 29 unmerged branches and six worktrees is how a feature gets "absorbed" from a branch nobody meant to merge.

### Step 6 (this week): finish the test platform and make releases boring

Complete `docs/test-platform-setup.md` (about three hours of your time across sections 1–8; the runbook is already written):

- `production` environment with you as required reviewer, federated credential (section 1).
- Test resource group, web app, database restored from a live backup with credentials scrubbed (sections 3–5, 8).
- Repository variables `PULSE_TEST_WEBAPP_NAME`, `PULSE_TEST_RESOURCE_GROUP`, secrets (section 6).

Then the rhythm is: merge → test platform in 13 minutes → operators try it on the test address → owner tags → owner approves → production. One production release per day, in the evening, is enough.

### Step 7 (policy): what ships behind a flag

Any change to what an operator sees on the card board, the tiles, the review form or the auto-save rule ships with an environment flag that defaults **off** in production and **on** on the test platform, and is listed on `/api/health`. Yesterday's unflagged board changes (alias hints, batch-final header, right-click reject, once-per-card prompts, fleet dialog buttons) each get a flag retroactively in the step 3 split so any one of them can be switched off without a release.

## 4. Known defects right now

| # | Defect | State |
|---|---|---|
| 1 | Server refuses cards the browser shows as ready (missing masters) | Fixed in PR 61 on `main`; **not live** (production on PR 60) |
| 2 | "Extraction needs checking" checkbox missing, recovered cards refused | Fixed in PR 61 on `main`; **not live** |
| 3 | The 17:29 crash on 2 November (equipment review dialog open, screen replaced) | Cause never identified; `GET /api/client-errors` now records the next one (PR 45). Check it after the next session with real cards. |
| 4 | Test-platform workflow on `main` fails or hangs | Platform not provisioned; runbook pending (step 6) |
| 5 | Open PRs 33, 42, 52 and 29 unmerged branches | Triage: merge, or close and delete, before step 3's reformat |

## 5. How you will know it worked

- Repair-only commits (section 1, row 7) drop to zero over a week.
- No production release is the first place a VLB change runs.
- `/api/client-errors` stays empty for the VLB screen across a full shift of scanning.
- A change to the scan page is a diff of tens of lines in one small file, reviewable in a minute.
