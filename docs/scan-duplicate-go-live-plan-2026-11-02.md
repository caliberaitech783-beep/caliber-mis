# Scan duplicates: go-live plan

Date: 2 November 2026. Branch: `fix/vlb-entry-r4`. Platform: Caliber Pulse-II (MIS), Trip Cards · Scan & Review (VLB) and ELB.

## 1. The rule going live

A card is a **duplicate** when the same physical card, for the same card date, site and shift, already exists in any scan entry or saved log book that is not rejected.

- Duplicates are detected **at upload**, before the reader runs, by comparing how the page looks (visual fingerprint), with the exact byte hash kept as a fast first check.
- Duplicates are **never read, never counted, never saved**. They are listed in a Duplicates tile with the original named, and can be restored with one click if the operator disagrees.
- A card the fingerprint cannot decide on is read normally and then checked by **content** (date, door, A-form / job card number) across every entry for that date, site and shift and against saved log books.
- A card is **never dropped silently**. Every system decision is visible on the card status board and reversible.

Worked example: entry B01 holds 40 cards for Majri OB, 01-11-2026, shift I. The operator scans 42 cards again, 40 of them the same paper. Result: "42 cards scanned. 40 duplicates of entry B01 skipped. 2 new cards queued for reading." The Duplicates tile lists the 40 with their original card numbers. Only 2 cards are read.

## 2. Why the current system does not do this

| Check today | Compares | Scope | Gap |
|---|---|---|---|
| Upload (bulk-card-scanning.mjs, POST cards) | SHA-256 of image bytes | All entries | A rescan is never byte-identical, so it passes |
| After reading (checkScanCard) | date + door + card number | Same entry only | Repeats across entries B01 / B02 are invisible |
| At save (log-book.mjs) | date + door + card number against saved records; one manual card per tipper per shift | Saved records only | Fires only once the original is saved, after the repeat was already read |
| Operational date filter (operational-start.mjs) | reader's header date before the entry date | All queries | A misread date hid the card from every check; fixed in this branch, prerequisite for everything below |

## 3. Work items

### Item A. Operational date filter uses the scan-entry date (done, uncommitted)

File: `operational-start.mjs`, test `test/operational-start.test.mjs`.
Order is now: saved log-book date, then scan-entry date, then reader date, then upload date. A misread header shows as a Mismatch card inside its entry instead of vanishing. Regression test covers listing, batch count, mismatch flag and duplicate detection of such a card.

### Item B. Visual fingerprint on every card

New module `scan-fingerprint.mjs`.

1. Decode the uploaded PNG / JPEG / WebP with `@napi-rs/canvas` (already used by `gemini-card-images.mjs`), after the same orientation step the reader uses, so a card fed the other way still matches.
2. Convert to grayscale and compute a difference hash for four fixed regions of the card layout, defined per card type (VLB trip card, ELB job card): header block (date, door, driver, card number), trip grid, machine-wise summary, meter block. Each region: 17 x 16 grid, 256 bits. Whole-page hash is also stored for diagnostics.
3. Store on `mis_scan_cards` as `fingerprint JSONB` (region name to hex string) with a GIN-free plain column and an index on `(batch_id)`; comparison is done in Node over the candidate set, which is small (same date, site, shift).
4. Backfill: a one-off job computes fingerprints for all cards created on or after 1 November 2026, so existing entries (B01) can be matched against. Runs on deploy, idempotent, logged.

Accuracy work before any skipping is enabled:

- Run the hash over every card already in the database. Record the distance between known rescans (same card number, door and date in two entries) and between genuinely different cards for the same shift.
- Pick two thresholds with a clear margin: **skip** (every region within T1 bits) and **suspect** (any region within T2 bits). Starting values T1 = 8, T2 = 20 of 256, to be replaced by measured values. The thresholds live in one place (`scan-fingerprint.mjs`) and are reported in the health endpoint.

### Item C. Duplicate decision at upload

File: `bulk-card-scanning.mjs`, POST `/api/scan-batches/:id/cards`.

Inside the existing transaction, after the byte-hash check:

1. Load candidate cards: non-rejected cards in every entry whose `expected_context` has the same `bookDate`, `location` and `cardShift`, plus cards already posted whose log book is not deleted.
2. Compare fingerprints. Outcomes:
   - **Exact bytes match** (today's path): skipped, `duplicateSkipped:true`, original named. Unchanged.
   - **All regions within T1**: card row is inserted with `status='rejected'`, `review_note='Duplicate of card <ordinal> in entry <name>'`, `duplicate_of=<card id>`. It is not queued for reading. Response: `{duplicateSkipped:true, original:{cardId,batchId,ordinal,bookNo}}` so the client counts it the same way.
   - **Any region within T2** but not all within T1: inserted normally, queued for reading, with `raw_fields.duplicateSuspect={cardId,batchId,ordinal,distance}`.
   - Otherwise: new card, unchanged path.
3. Advisory locks already serialise same-hash uploads; the same lock key is extended to the fingerprint candidate set (lock on date+site+shift) so two concurrent uploads of the same paper cannot both pass.

### Item D. Content check after reading, across entries

File: `bulk-card-scanning.mjs`, `checkScanCard`, and the extraction completion path in `scan-extraction-queue.mjs`.

1. When reading completes, compare date + door (asset id) + card number against non-rejected cards in **every entry** for the same date, site and shift, and against saved log books (existing query, scope widened).
2. If a match is found **and** the card number and door were read with no review flag: auto-reject with `review_note='Duplicate of card <ordinal> in entry <name>'` and `duplicate_of`. Also covers a card that was only a fingerprint suspect.
3. If a match is found but the card number or door is unreadable or flagged for review: keep the card in Needs attention with the error "Possible duplicate of card 7 in entry B01. Confirm the card number and door." Nothing is rejected on uncertain data.
4. The existing same-entry sibling message and the "Card already exists in book no" message remain for anything that reaches save.

### Item E. Duplicates tile and restore

Files: `scan-card-groups.mjs`, `src/bulk-card-scanning.jsx`, GET `/api/scan-batches/:id`.

1. GET returns duplicate cards (today they are filtered out by `review_note`) with `duplicate_of` resolved to `{entryName, ordinal, bookNo, cardId}` and a thumbnail URL for the original.
2. New tile **Duplicates** on the Card status board: "Same card already in another entry · skipped". Count shown as `n/total`; duplicates are excluded from All cards, Review and the batch list counts so the operator's working numbers do not change.
3. Card view for a duplicate shows both images side by side (this scan, original) and a button **Not a duplicate, read this card**. Restore sets `status='queued'`, clears `duplicate_of` and `review_note`, records who restored it in `checked_by`, and queues reading. Restore is audited.
4. Upload notice: "42 cards scanned. 40 duplicates of entry B01 skipped. 2 new cards queued for reading." The notice also names other entries when duplicates come from more than one.
5. The "Checking card headers…" state no longer shows for an entry with no readable cards; it shows "No new cards in this entry" with a link to the entry that holds the originals.

### Item F. Telegram late-batch and batch report

Files: `vlb-batch-alerts.mjs`, `scan-batch-report` modules.
Duplicate cards are excluded from card totals in the batch report and in Telegram batch alerts. The report gains a one-line "Duplicates skipped: n (entries B01, B02)" footer so the count is auditable.

### Item G. Tests (all must pass before deploy)

PostgreSQL-backed (`embedded-postgres`) and PGlite tests:

1. Same 40-card file uploaded twice: 40 skipped by byte hash, 0 read.
2. Rescan fixture: 40 cards re-rendered with 2 px shift, +4% brightness and noise: 40 skipped by fingerprint, 2 new cards read.
3. Rescan at the suspect threshold: card read, then auto-rejected by content check with the original named.
4. Repeat with unreadable card number: held in Needs attention with "Possible duplicate", not rejected.
5. Repeat of a saved card (original posted): skipped, original shows the book number.
6. Two genuinely different cards for the same shift with similar writing density: both kept (uses real anonymised scans from the measured set).
7. Restore: duplicate restored, read, saved; audit row written.
8. Concurrency: the same paper uploaded from two browsers at once yields one card and one duplicate.
9. Misread header date inside a 1 November entry stays listed and counts as a duplicate on rescan (done).
10. Notice text and tile counts in the React component tests.

## 4. Rollout

| Step | Action | Owner | Check |
|---|---|---|---|
| 1 | Merge Item A now (small, safe) and deploy | Dev | Open B01 for Majri OB 01-11 shift I: the two hidden cards appear under Mismatch cards |
| 2 | Build Items B to G on `feature/scan-duplicates`; flag `SCAN_DUPLICATE_FINGERPRINT` default off | Dev | CI green |
| 3 | Deploy with flag off; backfill fingerprints; export distance report | Dev | Report shows clear gap between rescans and different cards |
| 4 | Set thresholds from the report; enable flag on the test platform; operator rescans one real batch | Dev + Anoop | 40 skipped, new cards read, nothing genuine skipped |
| 5 | Enable on production for VLB, then ELB after one full shift without a false skip | Dev + PM | Duplicates tile counts match the paper count |
| 6 | Remove flag after seven clean days | Dev | — |

Rollback: turn the flag off. Cards already marked duplicate stay visible in the Duplicates tile and can be restored; no data is deleted at any step.

## 5. What this does not cover

- A second card written out by hand for the same tipper and shift is not a rescan. It is caught only by the content check (same date, door and card number) or by the one-manual-card-per-tipper-per-shift rule at save.
- Cards for a different date, site or shift than the entry are Mismatch cards, handled by the existing header check, not by this plan.

## 6. Build status (2 November 2026, branch feature/scan-duplicates)

| Item | Status | Where |
|---|---|---|
| A. Date filter uses the scan-entry date | Done, committed on fix/vlb-entry-r4 | operational-start.mjs |
| B. Visual fingerprint | Done. Method changed from the planned difference hash to ink-overlap on a 64-column grid with coarse-to-fine alignment, because the hash flipped on mostly-white paper. Synthetic rescans score 8 or less, different cards 33 or more (skip 15, suspect 30). Backfill runs on server start. | scan-fingerprint.mjs, scan-duplicates.mjs |
| C. Duplicate decision at upload | Done. Exact bytes always; fingerprint only with SCAN_DUPLICATE_FINGERPRINT=true. Duplicates stored as rejected rows with duplicate_of, never queued, not counted for entry space. | bulk-card-scanning.mjs POST cards |
| D. Content check across entries | Done. Certain identity auto-rejected after reading; uncertain held with "Possible duplicate of card N in entry …". | scan-duplicates.mjs, checkScanCard |
| E. Duplicates tile, restore, notice | Done. Tile on the card status board, side-by-side scans, "Not a duplicate, read this card", POST /api/scan-cards/:id/restore-duplicate. | src/scan-duplicate-list.jsx, src/bulk-card-scanning.jsx |
| F. Reports | Done for the batch report footer and batch list counts. Telegram alerts count VLB batch records, not scan rows, so no change was needed. | src/scan-batch-report.jsx |
| G. Tests | 7 new tests across scan-fingerprint.test.mjs and scan-duplicates.test.mjs; the concurrency case (8) could not be written because the test database stubs advisory locks. Covered by the same date/site/shift advisory lock in code; verify on the test platform. | test/ |
| Measurement | scripts/scan-fingerprint-report.mjs prints same-card versus different-card distances per context. Run before step 4 of the rollout. | scripts/ |
