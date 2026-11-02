# Two-stage VLB + ELB batch — implementation draft

Status: final draft for the test platform, not yet built. Date: 1 November 2026. Target: test platform first, live Pulse-II only after team sign-off (section 10).

## 1. Goal

One batch per site, date and shift carries both the tipper cards (Vehicle Log Book, VLB) and the loading-machine cards (Equipment Log Book, ELB). The batch closes only when every machine that loaded tippers in that shift has its own ELB card saved in the same batch. The VLB trip rows are the single source of truth for "which machine loaded how many trips"; no separate trip count is asked on the ELB side.

## 2. Decisions taken

| Topic | Decision |
|---|---|
| Trip cross-check between VLB and ELB | Not required. VLB trips per machine are trusted as correct. ELB closure only proves the machine was logged. |
| Equipment master authority | Pulse (pulse.cmll.in) is the only Equipment master. Pulse-II holds no master of its own; it reads Pulse through the existing automatic one-way sync. Transfers and new equipment approved by OTP in Pulse-II must land in Pulse, see section 6. |
| Zero trips, Working | Allowed only with working hours greater than zero. A machine with zero trips and zero hours cannot be Working; it must be saved as maintenance, no operator, breakdown or not in use. |
| Machine identity | `V19`, `VL19`, `VPC 019`, `VPC-019` are the same machine. Reconcile on the resolved Equipment master id, never on the written label. |
| Asset from another site | Hold the card, never reject it, and never ask an OTP for VLB or ELB entry itself. The card waits until the asset is transferred to this site in the Equipment master. From the entry screen the operator can raise an express transfer: one OTP sent to the PM of the site where the asset currently shows in Pulse completes the transfer instantly. Applies to any door: tipper, loader, dozer, grader. |
| Equipment not in the master at all | New purchase. The operator creates it from the entry screen; one OTP to the PM of the entering site approves the creation and the card proceeds. Not a general master shortcut; only from an open batch. |
| One open batch per site | Kept. A site runs up to three shifts a day; the previous shift's batch must be closed before the next one opens. Existing trigger `mis_vlb_one_open_site_guard` is unchanged. |
| Machine-wise report | Build it. After closure, the batch report shows per machine: trips loaded (VLB), hours worked (ELB HMR), trips per hour. |
| ELB stage covers the whole fleet | Every machine booked at the site in Pulse appears, not only the loaders. Trips are filled automatically from VLB. Each machine gets a shift status: working, breakdown, maintenance, no operator, not in use. |
| ELB entry style | One small dialog per machine with Next, Previous, Skip and auto-save. Only hours, status and breakdown details are typed. |
| ELB outside a batch | Not allowed (2 November 2026). ELB Manual and ELB Scan open from the same site batch picker as VLB and show the editor only when the selected batch is at the ELB stage. The server refuses an ELB whose site, date and shift have no batch, or whose batch still has VLB open, with the same 409 as a standalone VLB. Standalone ELB saving is discontinued; with the flag off the old behaviour returns. |
| Go-live | Test platform first with a feature flag; live on Pulse-II only after team sign-off. |
| Reopen and Unlock VLB by OTP (added 2 November 2026) | The site PM may approve a batch reopening, or an Unlock VLB, by reading out an OTP to the MIS user by phone instead of signing in. On-screen approval stays available. A PM who is also the MIS requester may approve their own reopening request on screen; the audit records both roles. |

## 3. Batch lifecycle

Today a batch has one lifecycle field, `closed_at`. Replace it with an explicit stage; `closed_at` stays and is set only on the last transition so existing reports, reopen requests and the PM trial keep working.

| Stage | What is allowed | Transition |
|---|---|---|
| `vlb_open` | Add, correct, delete VLB cards (manual, scan, PDF upload). ELB entry is disabled for this batch. | **Lock VLB** by the batch owner. Blocked while any VLB card is awaiting a transfer or has unresolved machine labels. |
| `elb_open` | VLB cards are frozen. The full site fleet list opens, trips pre-filled from VLB. Work through machines one by one in the stepper dialog, or scan/upload ELB cards. | **Close batch** by the batch owner. Blocked by the checks in section 5. |
| `closed` | Everything frozen. Reports and exports run. `closed_at` set, `closure_revision + 1`. | **Reopen** via the existing reopen request and PM approval, given on screen or by the PM's OTP (section 6, last part). Reopen returns the batch to `elb_open`; a second explicit "Unlock VLB" action, by the PM on screen or by the MIS user with the PM's OTP, returns it to `vlb_open` and clears the machine snapshot. |

Batch creation sets `stage='vlb_open'`. The "one open batch per site" guard treats `vlb_open` and `elb_open` both as open, which it already does because `closed_at IS NULL` in both.

## 4. Schema changes (additive only)

```sql
ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'vlb_open'
  CHECK (stage IN ('vlb_open','elb_open','closed'));
ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS vlb_locked_at TIMESTAMPTZ;
ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS vlb_locked_by TEXT;
UPDATE mis_vlb_batches SET stage='closed' WHERE closed_at IS NOT NULL AND stage='vlb_open';

-- Machines expected at closure, frozen at Lock VLB time.
CREATE TABLE IF NOT EXISTS mis_vlb_batch_machines(
  batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id),
  asset_id BIGINT NOT NULL,                -- Equipment master id
  machine_label TEXT NOT NULL,             -- display label as written, e.g. VPC-019
  trips INTEGER NOT NULL,
  source_cards INTEGER NOT NULL,           -- how many VLB cards named this machine
  PRIMARY KEY (batch_id, asset_id));

-- Every machine booked at the site when VLB locked, with the ELB progress for the shift.
CREATE TABLE IF NOT EXISTS mis_vlb_batch_fleet(
  batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id),
  asset_id BIGINT NOT NULL,
  door TEXT NOT NULL, equipment_name TEXT NOT NULL, equipment_group TEXT,
  trips INTEGER NOT NULL DEFAULT 0,        -- from mis_vlb_batch_machines, 0 when not named
  shift_status TEXT CHECK (shift_status IN ('working','working_partial_breakdown','breakdown','maintenance','no_operator','not_in_use')),
  draft JSONB,                             -- auto-saved dialog fields before validation passes
  logbook_id BIGINT REFERENCES mis_log_books(id),
  saved_at TIMESTAMPTZ, saved_by TEXT, skipped BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (batch_id, asset_id));

-- ELB cards belonging to the batch. Mirrors mis_vlb_batch_entries for vehicle cards.
CREATE TABLE IF NOT EXISTS mis_elb_batch_entries(
  batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id),
  logbook_id BIGINT PRIMARY KEY REFERENCES mis_log_books(id),
  snapshot JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS mis_elb_batch_entries_batch ON mis_elb_batch_entries(batch_id);

-- Express transfer OTPs, one live OTP per Vehicle transfers record.
CREATE TABLE IF NOT EXISTS mis_vehicle_transfer_otps(
  id UUID PRIMARY KEY,
  transfer_id BIGINT NOT NULL,             -- master_records id of the Vehicle transfers record
  batch_id UUID REFERENCES mis_vlb_batches(id),
  asset_id BIGINT NOT NULL,
  requested_by TEXT NOT NULL, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_to TEXT[] NOT NULL,                 -- source-site PM logins that received the OTP
  otp_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','used','expired','cancelled')),
  used_at TIMESTAMPTZ, approved_by TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS mis_vehicle_transfer_one_live_otp ON mis_vehicle_transfer_otps(transfer_id) WHERE status='sent';

-- New equipment requested from an entry screen, pending the site PM's OTP.
CREATE TABLE IF NOT EXISTS mis_equipment_create_requests(
  id UUID PRIMARY KEY,
  batch_id UUID REFERENCES mis_vlb_batches(id),
  site TEXT NOT NULL, door TEXT NOT NULL,
  draft JSONB NOT NULL,                    -- the Equipment master fields entered
  card_draft JSONB,                        -- the VLB/ELB card waiting on this asset
  requested_by TEXT NOT NULL, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_to TEXT[] NOT NULL, otp_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','used','expired','cancelled')),
  approved_by TEXT, used_at TIMESTAMPTZ, equipment_id BIGINT);
CREATE UNIQUE INDEX IF NOT EXISTS mis_equipment_create_one_live ON mis_equipment_create_requests(site,door) WHERE status='sent';
-- Site holds are not stored as a status. A card records data.siteHolds at save time and the
-- batch re-evaluates each held asset against the current Equipment master on every read.
```

`mis_vlb_batch_audit` records every transition: `vlb_locked`, `vlb_unlocked`, `elb_card_added`, `site_hold_recorded`, `express_transfer_requested`, `express_transfer_completed`, `site_hold_cleared`, `equipment_create_requested`, `equipment_created_express`, `batch_closed` (keep `saved_and_locked` as the action name for compatibility with existing audit consumers).

## 5. Lock VLB and Close batch checks

### Lock VLB (`vlb_open` → `elb_open`)

1. Batch must have at least one VLB card.
2. No VLB card in the batch may be awaiting a transfer (section 6).
3. Every trip row's `equipmentName` must resolve to exactly one Equipment master id through the existing card machine rules (`CARD-MACHINE-RULES.md`, `resolveTripEquipment`). An unresolved label blocks the lock and names the card and row.
4. Build the machine snapshot: group trip rows by resolved asset id, sum `tripCount`, count source cards. Insert into `mis_vlb_batch_machines`. The snapshot is stored, not recomputed, so a later correction cannot silently change what ELB is checked against; correcting VLB after this point requires Unlock VLB, which deletes and rebuilds the snapshot.
5. Build the fleet list: every equipment-kind Equipment master record at this site, into `mis_vlb_batch_fleet`, with trips copied from the snapshot.
6. Set `stage='elb_open'`, `vlb_locked_at`, `vlb_locked_by`. Audit `vlb_locked` with the snapshot and fleet count.

### ELB stage: the whole site fleet, one machine at a time

When VLB locks, the ELB stage does not start from a blank form. It starts from the full list of equipment booked at this site in Pulse, not only the machines that loaded tippers. Dozers, graders, drills, water tankers and machines standing in maintenance all appear, because the shift record must say what every machine did, including nothing.

**Building the list**

- Source: every record in the Pulse-synced Equipment master whose current site is the batch site and whose kind is equipment (`assetBookKind`), at the moment VLB is locked. Pulse is the only authority for which machine is booked where; Pulse-II keeps no fleet of its own. The list is stored with the batch as `mis_vlb_batch_fleet` so a later master change does not alter what the shift was asked to account for.
- Each row carries trips loaded, filled automatically from the machine snapshot. Machines not named on any tipper card show zero trips.
- A machine named on tipper cards but not booked at this site is already handled by the awaiting-transfer rule; it appears in the list with a transfer badge once the transfer completes.
- The list is ordered: machines with trips first, by trips descending, then the rest by door number. A header shows progress: `7 of 23 machines saved`.

**One dialog per machine**

The operator works through the list in a stepper dialog rather than opening a separate ELB form for each machine:

- The dialog shows the machine, its trips loaded (read-only, from VLB), the tipper cards that named it, and the previous shift's closing HMR as the proposed opening HMR.
- The operator enters: shift status, operator or driver (from the employee master, optional when the status is no operator), opening HMR, closing HMR, breakdown hours with reason, idle hours, job card number, remark. Working HMR, availability and idle are calculated the same way the ELB form does today.
- **Shift status** is a required choice and drives the rules:

  | Status | Meaning | Required | Allowed trips |
  |---|---|---|---|
  | Working | Machine ran this shift | operator, opening and closing HMR, working HMR greater than zero | any |
  | Breakdown | Under breakdown for the whole shift | breakdown hours = shift hours, reason | must be 0 |
  | Maintenance | Planned maintenance or service | reason or job card number | must be 0 |
  | No operator | Fit but nobody to run it | none | must be 0 |
  | Not in use | Parked, no requirement | none | must be 0 |
  | Working, partial breakdown | Ran part of the shift | operator, HMR, breakdown hours less than shift hours, reason | any |

  A machine with trips loaded cannot be saved as anything but Working or Working, partial breakdown. The dialog says why: `VPC-019 loaded 42 trips on 5 tipper cards this shift.` A machine with zero trips may be Working, which is normal for a dozer or grader, but only when closing HMR minus opening HMR is greater than zero. Zero trips and zero hours is not a working machine: the dialog refuses Working and asks the operator to choose maintenance, no operator, breakdown or not in use, with the reason that status needs. The batch report then counts that machine under the chosen category.
- Breakdown hours already recorded in Pulse for that machine and shift are shown next to the field, as the ELB form shows them today, so the operator can accept or override them. Overrides are kept with a reason.
- **Next** saves the current machine and opens the next unsaved one. **Previous** goes back to the last saved machine for correction. **Skip** leaves a machine unsaved and moves on; skipped machines are listed in the header and must be completed before closure.
- **Auto-save**: every field change is written to a draft row for that machine after a short pause, so a dropped connection or a closed laptop at 2 am loses nothing. Returning to the batch reopens the dialog at the first machine that is not fully saved. A draft that fails validation stays a draft and is shown in amber in the list.
- Saving a machine in the dialog creates or updates its ELB record in `mis_log_books` with `book_type='equipment'`, exactly as a manual ELB does today, and links it in `mis_elb_batch_entries`. Scan and upload of ELB cards still work; a scanned card for a machine fills that machine's row and marks it saved.

**Closure rule, restated**

Close batch requires an ELB row with a shift status for every machine in the batch fleet list, not only for the loaders. A machine left blank blocks closure by name. The old rule "every loading machine has an ELB" is now a special case of this one, and it is where the trip consistency check lives: a loading machine saved as anything other than Working is refused at save time, so it cannot reach closure.

**Scope of the fleet list**

- Tippers do not appear here. They are the VLB side.
- Machines transferred into the site during the shift join the list when the transfer completes. Machines transferred out before VLB lock are not in the list.
- A machine that genuinely should not be on the list, because it left the site weeks ago and the master is wrong, is saved as Not in use with the remark, and the mismatch is flagged in the batch report for a master correction.

### Close batch (`elb_open` → `closed`)

1. Every row in `mis_vlb_batch_fleet` has a saved ELB with a shift status. Missing machines block closure; loaders are listed first with their trip count, e.g. `VPC-019 loaded 42 trips, no ELB saved`, then the rest by door number. Every row in `mis_vlb_batch_machines` is in the fleet list or has completed a transfer, so the loader rule is covered by this one.
2. No ELB card in the batch is awaiting a transfer.
3. Duplicate ELB for the same asset in the same batch blocks closure (same rule the production report already applies).
4. Set `stage='closed'`, `closed_at=NOW()`, `closure_revision+1`. Audit.

The production reports (`production-report.mjs`) already refuse to run when a productive machine has no ELB. After this change that condition cannot occur for a closed batch, so the report gate becomes a safety net rather than the place the operator first learns about it.

## 6. Asset from another site, or from no site

### Principle

Pulse is the only Equipment master. Pulse-II reads it through the automatic one-way sync and never keeps a competing fleet list. Any change to where an asset is booked, or to which assets exist, has to end up in Pulse, otherwise the next sync would show the old picture again. The OTP flows below therefore do two things: they record the approval in Pulse-II, and they carry the change to Pulse.

VLB and ELB entry never need an OTP. The only thing that needs approval is moving an asset from one site to another in the master, and that approval belongs to the PM of the site where the asset currently shows in Pulse. So the batch does not "release" anything. A card whose asset belongs elsewhere simply waits until the asset is transferred to this site. The OTP is a fast way to complete that transfer from the entry screen, and it works the same for any door: tipper, loader, dozer, grader, hydra.

### Detection during entry

Today `resolveLogBookData` rejects a card whose asset's `currentLocation` differs from the card location (`The selected asset is assigned to a different location.`), and the scan path blocks with `Equipment not assigned to this site`. Both change from reject to hold. The check covers:

- the tipper door on a VLB card,
- every loading machine named in VLB trip rows,
- the machine door on an ELB card.

### Hold behaviour

- The card is saved and linked to the batch with `data.siteHolds = [{assetId, assetSite}]` recorded at save time.
- The hold is not a stored status that someone clears. On every batch read, Lock VLB and Close batch, the server re-checks each held asset against the current Equipment master. The moment the master says the asset is at this site, the hold is gone and the card is a normal card. That is why one transfer clears every card naming that asset, in this batch and in any later batch.
- A held card is excluded from the machine snapshot, Lock VLB, Close batch and reports while the hold stands.
- Lock VLB and Close batch are blocked while any held card exists. The message is per asset, with cards and trips attached: `Awaiting transfer: VPC-019 from NIGAHI (2 cards, 17 trips), V-104 from NIGAHI (1 card)`.
- The batch page shows an **Awaiting transfer** panel, one row per asset, with the asset's current site, the cards attached, the state of any transfer already in progress, and the **Express transfer (OTP)** button.

### Express transfer by OTP

The existing Vehicle transfers workflow (`vehicle-transfer-workflow.mjs`, routes in `server.mjs`) runs in three steps: source PM approval, destination MIS verification, destination PM acceptance. Today completion updates `currentLocation` only in the Pulse-II synced copy, which the sync then preserves. With Pulse as the sole master, completion must instead write the new site to Pulse and let the sync bring it back, for the normal workflow as well as the express one. The express path is the same workflow with the three steps collapsed into one OTP:

1. The operator at the entering site presses **Express transfer (OTP)** on the asset row. If a transfer for this asset is already pending in the normal workflow, the panel shows its stage and offers to send the OTP for that record instead of creating a second one, since the workflow allows only one pending transfer per asset.
2. The server creates a Vehicle transfers record: source = asset's current master site, destination = batch site, transfer date = batch date, equipment fields copied from the master, remarks `Express transfer requested from VLB/ELB batch <name>`, status `Awaiting source approval`. The requesting user must be an MIS user or manager with the destination site in scope, which is the same rule as a normal submission.
3. The server finds the PM(s) of the **source** site through the existing `vehicleTransferPmLogins` lookup, generates a six-digit OTP, stores its hash with a ten-minute expiry against the transfer record, and sends one message per source PM, Telegram when linked, otherwise WhatsApp:

   ```
   Caliber Pulse: vehicle transfer approval
   VPC-019 is being logged at JAYANT OC but is assigned to NIGAHI.
   Transfer VT-...: NIGAHI -> JAYANT OC, date 01-11-2026
   Requested by <operator>, batch CMLL/JAYANT OC/1ST-NOV-26/S1/B02
   OTP 482913, valid 10 minutes. Share it only if you release VPC-019 to JAYANT OC.
   ```

   If no source PM has a linked Telegram chat or registered mobile, the request is refused with "Source site PM has no Telegram or mobile registered" and the transfer stays in the normal workflow for approval on screen.
4. The source PM shares the OTP with the operator by voice or message. The operator enters it on the asset row. Five wrong attempts or ten minutes kill the code; the transfer record remains and a new OTP can be requested after one minute.
5. On a correct OTP the server completes the transfer in one transaction: source approval recorded as the PM who received the OTP, destination MIS verification recorded as the requesting MIS user, destination acceptance recorded as `Express OTP transfer` with the requesting user's login, status `Completed`. The site change is then written to Pulse through an authorised transfer endpoint on Pulse, and the synced copy in Pulse-II updates on the next sync cycle, within a minute. Until Pulse confirms, the transfer shows `Sent to Pulse` and the held cards stay held; the batch page retries and shows an error if Pulse rejects it. Audit entries are the same as the three normal steps, each tagged `expressOtp: true`.
6. The destination site PM receives an informational Telegram that the asset has joined their site by express transfer. They are not asked to approve; if the asset should not be there, they raise a transfer back.
7. The batch re-reads the master, the hold disappears, and every card naming that asset, including its ELB when it arrives, is a normal card. No further action on the batch.

### Alignment with the Vehicle transfers OTP note

`docs/vehicle-transfer-otp-approval.pdf` and `docs/vehicle-transfer-otp-flowchart.pdf` propose OTP approval inside Masters > Vehicle transfers for the two PM stages, Release and Accept, keeping the four-stage chain. This draft reuses that design rather than inventing a second one:

- The express transfer raised from a batch is a normal transfer record. Its OTP is the **Release OTP** of that note, sent to every PM of the source site; the first valid code wins.
- Same controls everywhere: six random digits, hash only, single use, ten-minute expiry, five wrong attempts, one request per minute, requester and approver both recorded. The request button is available only to an MIS user or manager of the site concerned.
- Delivery channel: the note uses WhatsApp, the batch discussion asked for Telegram. The OTP sender tries the PM's linked Telegram first and falls back to WhatsApp when a mobile number is registered. If neither exists the button is hidden and the PM approves by logging in.
- Difference, by decision in the batch discussion: the express path completes the transfer on the Release OTP alone. Destination MIS verification is the requesting user, and destination PM acceptance is recorded as implied because the destination is the site asking. The note's separate Accept OTP remains available as a per-site setting for sites that want their PM to approve inbound express transfers too.
- The OTP fields, routes and audit lines are shared code in the transfer module, so building the note's proposal and this express path is one piece of work, not two.

### Why one OTP is enough

The source PM is the person giving the asset away, so that is the approval that matters. The requesting user is already the destination MIS, which covers verification. Destination PM acceptance exists in the normal workflow to stop assets being pushed onto a site unwanted; in the express case the destination is the site asking for it, so acceptance is implied and recorded, not skipped. If a site wants its PM to approve inbound express transfers too, that is a per-site switch that sends a second OTP to the destination PM before completion. It is listed as an option, not built in this draft.

### Normal transfer still works

Nothing in the batch depends on the express path. A transfer raised and approved the usual way clears the hold the same way, because the hold is re-evaluated against the master. An MIS administrator who cannot reach the source PM uses the normal workflow's approval screens as today.

### Dependency on Pulse: two write endpoints

Today the Pulse connector only reads masters; `ERP-LOCAL.md` records that no API call writes master changes back to Pulse. Both OTP flows need Pulse to accept two authorised writes: complete a vehicle transfer, and create an equipment record. These are small additions on the Pulse side, protected by the same service credential the sync uses plus the OTP approval record as evidence. They must be built and tested on the Pulse test instance before the Pulse-II test platform can exercise the OTP flows end to end. Until they exist, the test platform runs the OTP flows against a stub that updates the synced copy only, clearly labelled, so the batch flow itself can still be trialled.

### New equipment that exists at no site

A newly bought tipper or machine may reach the site before anyone has created it in the Equipment master. Its door number resolves to nothing, so the card can neither be saved against an asset nor held against another site. The entry screen handles this in place:

1. When a door or machine label on a manual, scanned or uploaded card matches no Equipment master record, the field shows **Not in Equipment master** with a **Create new equipment** button. The card itself is kept as a draft and is not saved until the asset exists.
2. **Create new equipment** opens a short form, prefilled from the card where possible: door number, category (tipper, excavator, dozer, grader, hydra, pay loader, as in `CARD-MACHINE-RULES.md`), make, model, registration number, chassis number, site = the batch site, and the first HMR/KMR reading from the card. Chassis or registration is mandatory, because that is the key the Pulse master sync later uses to link the record. Door number alone is not enough.
3. The server checks the Equipment master for the same chassis, registration or door at any site. A match anywhere means this is a transfer case, not a new asset, and the screen switches to the express transfer flow of the previous section. Only a genuinely unknown asset continues.
4. The server stores the draft equipment record in a pending table, generates a six-digit OTP with a ten-minute expiry, and sends it by Telegram to the PM of the **entering** site, since no other site owns the asset:

   ```
   Caliber Pulse: new equipment approval
   <operator> wants to add V-212 (Volvo FMX 460, chassis MC2..., reg MH40 ...) to JAYANT OC.
   Reason: card in batch CMLL/JAYANT OC/1ST-NOV-26/S1/B02.
   OTP 517204, valid 10 minutes. Share it only if this is a genuine new asset at your site.
   ```

5. The operator enters the OTP. On success the equipment record is created in Pulse through an authorised equipment-creation endpoint, with `currentLocation` = batch site and `createdVia: express-otp`, the approving PM and operator recorded. The next sync brings it into Pulse-II, the pending draft card is saved against the new asset id and linked to the batch, and an audit entry `equipment_created_express` is written. The card is now a normal card with no hold.
6. If the PM has no linked Telegram, the request is refused with "Site PM has not linked Telegram" and the asset must be created by an administrator through Masters as today.

Guard rails:

- The record is created in Pulse, never only in Pulse-II. If the Pulse endpoint is unavailable the request is refused with a clear message and the asset must be created in Pulse by its administrator as today; the draft card is kept for retry.
- Capacity for production reports comes from the make/model pair in the Capacity master. A new make/model still needs its capacity approved there; the batch can close without it, the production report will ask for it.
- One pending new-equipment request per door per site at a time. Same OTP controls as transfers: ten minutes, five attempts, one request per minute. The draft form is kept so the operator does not retype.
- Express creation is allowed only from a VLB or ELB entry screen with an open batch. It is not a general master-entry shortcut.

### PM approval by OTP for reopen and Unlock VLB (added 2 November 2026)

Both batch controls that need the site PM can now be approved by phone, with the same OTP engine and the same controls as the express transfer: six digits, hash only, ten minutes, five wrong attempts, one request per minute, single use. On-screen approval is unchanged and remains available; the OTP is a faster alternative, not a replacement.

**Reopen a closed batch.** In the reopen dialog the MIS user types the reason and presses *Request reopen OTP*. The server creates (or reuses) the same reopening request the screen uses, then sends the code to every current Project Manager of the batch site on Telegram, or WhatsApp when Telegram is not linked. The message names the batch, the site, date and shift, the requester and the reason, and says that reading out the code is the approval. The MIS user phones the PM, enters the code, and the request is marked approved (`decided_by` = the first PM the code went to, `decision_note` = "Approved by OTP sent to pm1, pm2"). The server then reopens the batch at once for that MIS user, exactly as the Reopen button would. If the reopen itself is blocked, for example another batch is open at the site, the approval is kept and the Reopen button works once the blocker is cleared. The OTP button is hidden while the owner-authorized PM trial is active, because no approval is needed then.

**Unlock VLB.** At the machine stage the batch owner or any MIS user sees *Unlock VLB (PM OTP)* next to the PM-only *Unlock VLB*. They type the reason, request the code, phone the PM and enter it. VLB unlocks with the usual effect (machine snapshot cleared, stage back to `vlb_open`); the audit entry `vlb_unlocked` carries `via: otp`, the PM logins the code went to, and the reason.

**Self-approval.** A user who is both the site PM and the MIS requester may approve their own reopening request on screen. The earlier block was removed on the owner's instruction; the audit still shows the same login as requester and approver.

**Storage and routes.** Table `mis_vlb_approval_otps` (purpose `reopen` or `unlock_vlb`, reopen request id, reason, requester, PM logins, hash, expiry, attempts, status). Routes: `POST /api/vlb-batches/:id/approval-otp {purpose, reason}`, `POST /api/vlb-batches/:id/approval-otp/:otpId/verify {otp}`, `GET /api/vlb-batches/:id/approval-otp`. The batch detail returns `approvalOtps` (the requester's live codes, so a reload resumes the entry) and `canRequestUnlockOtp`. Only the user who requested a code can enter it, and only against the batch it was issued for.

## 7. Machine-wise batch report

Available on a closed batch from the existing **View report** button, as a second section after the card list, and as part of the batch PDF/Excel.

| Column | Source |
|---|---|
| Machine | `mis_vlb_batch_machines.machine_label` and asset door |
| Trips loaded | `mis_vlb_batch_machines.trips` |
| Tipper cards | `source_cards` |
| Opening HMR / Closing HMR / Hours worked | the machine's ELB card in `mis_elb_batch_entries` |
| Trips per hour | trips ÷ hours worked, blank when hours is zero |
| Breakdown / idle hours | ELB card fields already captured |
| Transferred this shift | yes when the machine, or any tipper card that fed it, was held and cleared by a transfer completed on the batch date; the tooltip names the transfer number and approving PM |

A footer row totals trips and hours. Machines with zero trips appear below the line grouped by shift status: working, breakdown, maintenance, no operator, not in use. A second footer gives the fleet summary for the shift: total machines, working, down, idle. Day-wise totals across the three shifts already belong to the Day-wise Machine Number Report; this section is the shift-level view.

## 8. UI changes on Create Batch

- The batch card shows a two-step indicator: **1 VLB** and **2 ELB**, with the current stage highlighted and counts (cards saved, machines expected, machines with ELB).
- Stage `vlb_open`: buttons Manual, Scan, Upload (VLB) and **Lock VLB**. ELB buttons are visible but disabled with the hint "Lock VLB first".
- ELB menu: **ELB Manual** and **ELB Scan** show the site batch picker first. Until the selected batch is at the ELB stage the editor stays closed with the message "Lock VLB in batch … before entering ELB cards".
- Stage `elb_open`: VLB buttons become view-only. The fleet list is shown with trips and progress, **Start / Continue machines** opens the stepper dialog at the first unsaved machine, Scan and Upload remain for ELB cards, and **Close batch** replaces today's **Save & lock batch**.
- The stepper dialog: machine header with trips and source cards, shift status buttons, HMR and hours fields, Pulse breakdown hours shown beside the field, Previous / Skip / Next, and an auto-save indicator.
- Door and machine fields that match no master record show **Create new equipment**, which runs the new-equipment OTP flow in place.
- An **Awaiting transfer** panel lists held assets with current site, cards and trips attached, any pending transfer, and the **Express transfer (OTP)** / **Enter OTP** controls. Held cards show an Awaiting transfer badge naming the asset.
- Batch list status column shows `VLB open`, `ELB open`, `Closed` instead of `OPEN`/`CLOSED`.

## 9. Server work, in order

1. `vlb-batch-policy.mjs`: schema additions, `stage` helpers, snapshot builder, closure checks, hold helpers. Pure functions with unit tests for: label resolution (V19 = VPC 019), missing machine, other equipment ignored, held card blocking, duplicate ELB.
2. `vlb-batch-fleet.mjs`: fleet list builder at lock, `GET /api/vlb-batches/:id/fleet`, `PUT /api/vlb-batches/:id/fleet/:assetId/draft` (auto-save), `POST /api/vlb-batches/:id/fleet/:assetId` (validate, write ELB log book, link), shift-status rules with tests for the trips-versus-status refusal.
3. `vlb-batches.mjs`: new routes `POST /api/vlb-batches/:id/lock-vlb`, `POST /api/vlb-batches/:id/unlock-vlb` (PM), rename close semantics to run section 5 checks, `GET /api/vlb-batches/:id/machines`.
4. `log-book.mjs`: equipment books link into the batch when an `elb_open` batch matches; site mismatch produces a hold instead of a 400 for both kinds. Scan path: `scanFleetBlockingMessage` becomes a hold warning rather than a save block.
5. New `vehicle-transfer-express.mjs`: OTP table, `POST /api/vehicle-transfers/express` (create or reuse pending transfer, send OTP to source PMs), `POST /api/vehicle-transfers/:id/express-otp` (verify and complete all three steps in one transaction), informational Telegram to the destination PM. Site-hold evaluation lives in `vlb-batch-policy.mjs` and runs against the current Equipment master on every batch read.
6. New `equipment-create-express.mjs`: pending table, `POST /api/equipment/express` (duplicate check across all sites, draft, OTP to entering-site PM), `POST /api/equipment/express/:id/otp` (create master record, save waiting card, link to batch). Reuse the OTP hashing and attempt rules from the transfer module.
7. Report: machine section in `scan-batch-report.mjs` and the batch PDF/Excel.
8. Feature flag `VLB_TWO_STAGE_BATCHES` read per request, on by default, `0` turns the two-stage flow off without a redeploy.
9. Migration note: batches already closed before deployment get `stage='closed'` and no machine snapshot; the machine section shows "Not available for batches closed before two-stage processing".

## 10. Rollout: test platform first, live later

Nothing in this draft goes to the live Pulse-II site (pulse-ll.cmll.in) until the team has used it and agreed. The sequence:

1. **Feature flag.** All two-stage behaviour sits behind a server setting `VLB_TWO_STAGE_BATCHES`, on by default. `0` returns the site to single-step Save & lock batch with no schema change beyond the additive tables. The flag is read per request, so it can be switched without a redeploy. Decision on 1 November 2026: go live for all users directly.
2. **Pulse test instance.** The two write endpoints are added to a test copy of Pulse first. The Pulse-II test platform syncs from that copy, so express transfers and new equipment can be exercised end to end without touching the live Pulse master.
3. **Test platform.** A separate deployment with its own URL and its own PostgreSQL database, restored from a recent live backup through the existing Backup page export, so the team sees their real sites, fleet and employees. It connects to Pulse masters read-only exactly as the local ERP setup documents in `ERP-LOCAL.md`. Telegram OTPs go through a separate test bot and a test PM group, never the live PM chats. WhatsApp and email delivery are disabled. The page header carries a visible TEST banner.
4. **Team trial.** Site MIS users run real shifts in parallel: the live site as today, the test site with the two-stage flow, for an agreed number of days. Items checked: time per shift to complete the fleet dialog, how often transfers and new-equipment OTPs are needed, machine checklist accuracy against the scanned cards, and whether closure messages are understandable to the operator.
5. **Sign-off list.** The trial ends with a written list of changes from the team. Those are built and re-tested on the test platform. Only then is the flag turned on for the live site, one site first, then all.
6. **Rollback.** Turning the flag off returns the live site to single-step batches at once. Batches closed under the two-stage flow stay closed and readable; batches mid-stage are shown as open for the old Save & lock button.

## 11. Out of scope for this draft

- Trip count entered on the ELB card and any VLB-vs-ELB trip comparison.
- A per-site switch requiring a second OTP from the destination PM before an express transfer completes.
- Any OTP on VLB or ELB entry, locking or closing. Those actions need none. OTPs exist only for moving an asset between sites and for creating an asset that exists nowhere.
- Editing an existing Equipment master record from the entry screen. Only creation of a genuinely unknown asset is covered.
- Changing the three-shift / one-open-batch rule.

## 12. Build status and test platform switches

Built on branch `feature/vlb-elb-two-stage` (1 November 2026). Server modules: `vlb-two-stage.mjs` (flag, schema, pure rules), `vlb-batch-stages.mjs` (lock, fleet, stepper save, ELB linking, closure checks), `otp-approval.mjs` and `otp-delivery.mjs` (shared OTP controls, Telegram first then WhatsApp), `vehicle-transfer-express.mjs`, `equipment-create-express.mjs`. Tests: `test/vlb-two-stage.test.mjs`, `test/express-otp.test.mjs`, `test/vlb-two-stage-ui.test.mjs`.

| Switch | Value on the test platform | Live default |
|---|---|---|
| `VLB_TWO_STAGE_BATCHES` | unset (on) | on for all users from 1 November 2026; set `0` to fall back to single-step Save & lock batch |
| Pulse write endpoints | not available yet; the writer records `pulseWrite.mode = local-only` on each express transfer and new asset | same |
| OTP delivery | Telegram via the MIS bot linked chats, WhatsApp fallback through the approved authentication template | same code, different bot and numbers |

The feature is on by default. Setting  on the App Service turns it off without a redeploy: the new tables stay but unused, the new routes answer 409, and the batch API returns to the single-step shape. That is the rollback.

Open items before go-live: the two Pulse write endpoints (section 6), a per-site option for a destination-PM OTP, and the team's change list from the trial.

2 November 2026: PM approval by OTP for batch reopening and Unlock VLB added (`vlb-approval-otp.mjs`, `src/vlb-approval-otp.jsx`), self-approval of a reopening request allowed for a PM who is also the requester. Tests: `test/vlb-approval-otp.test.mjs`, `test/vlb-approval-otp-ui.test.mjs`. No new switch: it is available wherever the OTP delivery is configured, which it is on live.
