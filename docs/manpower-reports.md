# Manpower, shift performance and OT reports

Open **Reports → Manpower & OT** in Pulse-II. The three views are **Manpower by Category**, **Shift Performance** and **OT & Multiple Duties**. Existing Reports permissions and assigned-site scope apply. The read-only endpoint is `GET /api/reports/manpower`; it uses the same session, administration and current site checks as saved operational reports.

Select up to 31 days, site, shift, saved batch, employee or equipment. Source records are active saved VLB/ELB cards dated from 1 November 2026, joined to synced equipment, employee and effective shift masters. Pending scans are excluded. Empty batches are selectable but contribute no assignments. Open batches are labelled and can change. Deleted books and deleted/archived batch memberships are excluded. Make/model classifications reflect the current synced master; numeric codes without names appear in Data Review.

Manpower counts distinct equipment and employees within each date/site/shift/category/make/model group. An employee changing equipment can occur in more than one category, so category employee counts are not additive. Details retain door, employee ID, mapped Caliber ID, assignment status, saved card, source batch and remarks. Employee names are never identity keys. Unresolved or conflicting IDs remain visible for correction.

Performance groups a resolved employee by site, operational date and shift. Several valid cards or vehicles in one shift remain one duty. Asset and batch filters select a duty; its full contributing cards remain visible. Exact repeated records and possible repeated measurement cards are omitted and listed for review. Conflicting overlaps, invalid meters and excessive aggregate HMR produce unavailable performance totals, never inflated numbers. Trip totals use existing cross-shift trip handovers. No combined hours across shifts appear in the performance view.

The separately approved OT flags are:

| Pattern | Flag |
| --- | --- |
| Shift 1 → Shift 2; Shift 2 → Shift 3 | Red when effective schedules are consecutive |
| Shift 3 → next day’s Shift 1 | Red when the date-aware schedules are consecutive |
| Shift 1 and Shift 3 without Shift 2 | Orange when a scheduled gap exists |
| All three shifts | Red takes priority |
| Missing/ambiguous schedule, conflicting start or other shift pattern | Review |

OT loads one adjoining day on both sides of the chosen range, subject to the operational cutoff and site authorization. Shift, vehicle and batch filters select events without discarding linked duties. Same-day and overnight events can share a duty; event hours must not be summed across rows. Written RED/ORANGE/REVIEW reasons are included in screen, print and exported data. Scheduled times are IST. Actual employee clock-in/out and attendance are unavailable in the current logbook source. HMR hours are machine performance, not attendance or payable OT. Payable OT hours/rates/rounding, required manpower, shortages and relief staffing are outside this release.

The new calculation and API tests cover approved patterns, midnight boundaries, date-effective schedules, duplicate cards, IDs, empty batches, vehicle changes, incomplete data and access scope. `test/manpower-report-postgres.test.mjs` exercises the actual SQL and HTTP handler in an isolated schema when `DELETION_TEST_DATABASE_URL` points to the local test `caliber_mis` database; the existing CI/release workflow provides this database. Run `npm test` and `npm run build` before release.

## OT & Multiple Duties: sites first (9 Nov 2026)

- The OT view always loads every site assigned to the login. The top row shows RED / ORANGE / REVIEW totals and one card per site; duty details appear after a site is opened. The Site selector opens the same site.
- Opening a site adds a table of flagged drivers by category. Driver category is the current designation in the Employee master (`currentDesignationName`, then `designationName`); the equipment worked is shown beside it.
- Pressing a colour lists the drivers with that flag and their earlier repeats at the same site. Earlier repeats come from `GET /api/reports/manpower/ot-history`, which reads only when asked, one week at a time, up to 90 days before the selected dates and never before 1 November 2026. It uses the same duty rules as the report but skips trip-handover linking, which does not affect shift patterns.
- The old count cards, colour legend and HMR notice were removed from this view; the calculation notes remain under "Sources and calculation rules".
- Filters on all Manpower & OT views have an "Auto-hide filters" option and a "Today" button. The current From–To dates stay visible when the filters are tucked away. The side menu has its own "Auto-hide menu" option. Both choices are remembered per browser.


## OT by log book: VLB, ELB and LMV (9 Nov 2026)

- The OT view reads all three log books. Saved LMV log books count as duties, so an LMV shift next to a VLB or ELB shift is flagged like any other pattern. The other Manpower views (category, shift performance, attendance) stay VLB and ELB only, and LMV review items are shown on the OT view only.
- Every flagged duty carries the log books it was saved in (`logBooks`, shown as the "Log book" column, for example "VLB + LMV"). A duty saved in two log books is listed under both, so the VLB, ELB and LMV rows can add up to more than the "All" row.
- The flag summary is a grid: one row for all log books and one each for VLB, ELB and LMV, with RED / ORANGE / REVIEW counts. Pressing a row narrows the page to that log book; pressing a count also lists those drivers with their earlier repeats.
- Each site card lists the three log books with their red, orange and review counts (`otSites[].books`).
- Earlier repeats read the same three log books and count the driver across all of them.
- HMR is optional on an LMV card. A card saved without it still counts as a duty; its hours show as unavailable and it is not listed for review.

## Driver category drill-down (9 Nov 2026)

- In an opened site, the "flagged drivers by driver category" table is clickable. Pressing a category name or its driver count lists that category; pressing a red, orange or review number lists only that colour within it. Pressing the same choice again shows every category.
- The choice adds a drivers table (one row per driver: red, orange and review duties, log book, duty dates, shifts and equipment) and narrows the duty table under it. It does not change the totals, the site cards or the earlier-repeats list above.
- A colour pressed in the category table takes priority over a colour pressed in the totals grid for the two lists under the table.

## Driver OT counts and history (9 Nov 2026)

- The drivers list has two columns right after the name: OT in the month and OT in the calendar year of the report's To date. One OT is one flagged duty (red, orange or review) at the opened site. An overnight pair counts once, on the day it started.
- Pressing a driver's name opens his history for that year: a month-wise table (red, orange, review, OT times, with a year total) and every flagged duty, newest first. Pressing the name again, or "Close history", closes it.
- The counts come from `GET /api/reports/manpower/ot-drivers?site=...&to=...` (same access chain and site scope as the report, site required). It reads the site one month at a time from the later of 1 January and 1 November 2026 up to today, using the slim card read of the earlier-repeats lookup, and holds no transaction open. The page asks once per site and month, only while a drivers list is open.
- Cost grows through the year: by December the busiest site needs twelve monthly reads. If that becomes slow, store monthly counts instead of recomputing them.

## Shift Attendance Equipment Wise (9 Nov 2026)

"Shift Attendance" is renamed **Shift Attendance Equipment Wise** in the side menu, the tab, the heading and the exported file. It opens in three steps instead of one flat list.

1. **All sites, shift-wise.** One row per site assigned to the login (a site with no duty shows zeros), with Shift 1, Shift 2, Shift 3 and All shifts, plus an All sites row. The numbers are actual duties. Choosing a site in the filter loads that site only and opens it directly.
2. **Duties by equipment.** Pressing a number lists that site and shift by equipment, with two totals and four colour counts.
3. **Driver list.** Pressing an equipment (or a colour count) lists its drivers. Date, site and shift are in the heading and the export title; each returns as a column only when the list covers more than one (a date range, All sites, All shifts, All equipment).

Two totals:

- **Actual duties**: one per driver per date and shift, whatever number of machines were driven. This is the number to use for salary.
- **Equipment-wise duties**: the driver counted once on every equipment group worked in that shift. A driver on a tipper and then a grader adds one to each.
- The one actual duty sits on the machine with the most HMR hours in that shift; when hours are missing or equal, on the card saved first. The other machine's row shows "Actual duty: No — second machine" and names the main machine. The same rule applies to a driver who worked at two sites in one shift, so site totals never double count.
- Two machines of the same group in one shift are one equipment-wise duty with both door numbers.

Equipment names:

- The name is the machine's **group in the Equipment master** (`group`, then `equipmentGroup`, then `itemName`), found through the door number on the saved card. Spelling differences in capitals and spaces are merged ("Water Tanker" and "WATER TANKER" are one row); the master is not rewritten. The tipper groups already carry the make (Volvo Tippers, Scania Tippers), so the make is not added to the name; make and model are a column in the driver list.
- A machine with no group, or a card with no Equipment master match, is listed under "Group missing in master" and stays in Data Review. A make saved as a number shows "Make not named".
- A zero-trip attendance entry names the equipment only when no card was saved for that driver and shift (its chosen machine, else "No equipment assigned"). Beside a saved card it adds its reason and remarks to the card's rows, never a second machine.
- Names follow the current master, so renaming a group there changes earlier dates too. Rows are ordered with the most duties first.

Row colours (one per row, in this order of priority):

| Colour | Meaning |
| --- | --- |
| Red | Back-to-back shifts, Shift 3 followed by the next day's Shift 1, or all three shifts |
| Orange | Shift 1 and Shift 3 with a gap |
| Brown | The OT report's "Review" pattern: two duties whose timing is not confirmed |
| Blue | Present with 0 trips: zero-trip attendance, or a VLB card saved with 0 trips |
| White | Normal duty |

- Red, orange and brown come from the same events as OT & Multiple Duties (saved VLB, ELB and LMV cards), so the two reports agree. Both shifts of the pattern are coloured and the note names the other shift. Review is brown in the OT view as well.
- An equipment operator with a saved ELB card is never blue: that work is measured in hours, not trips. A zero-trip driver without a card is not checked for red or orange, because OT reads saved cards only.
- Every row also carries the colour in words ("Duty flag") and the other shift or machine ("Duty note"), so exports and prints keep the meaning.

Data: `GET /api/reports/manpower` adds `attendanceEquipment` (one row per driver, date, shift, site and equipment group, with `actual`, `flag`, `flagLabel`, `note`) and `attendanceSites`. `shiftAttendance` (one row per actual duty) is unchanged. LMV log books are not part of this report.

## Missing batches, driver history and a simpler OT page (10 Nov 2026)

Owner's review of the live screens on 9 Nov 2026. This section replaces the OT layout described above (log-book grid, site cards, driver category table, earlier repeats).

Shift Attendance Equipment Wise:

- **Batch behind each shift.** Every site-and-shift box takes a state from the batch for that site, date and shift (`attendanceShifts`): the whole box is **red** while no batch has been created, **outlined orange** while the batch is created but not closed ("VLB open", "LMV open" or "ELB open", the stage from the batch rules), plain once it is closed. A line above the table counts the shifts without a batch and the open batches.
- A shift is reported as missing its batch only after it has ended by the Shift Master times, so the running shift is not red. A site is expected to run the shifts its Shift Master holds on that date (Shift 1 to 3 when it has none). A site with no work therefore stays red.
- Over several dates the box says how many days are pending ("3 days no batch"), and the opened site and shift lists the dates. The All shifts and All sites boxes carry the note without being painted.
- A red or orange box opens even when it has no duty, and says in words which batch is missing or open.
- **Driver history.** The driver list has "OT in <month>" and "OT in <year>" beside the name, and the name opens the month-wise history: duties, red, orange, brown and OT times per month, then every flagged duty. In a list of every site, the counts are read for the site of the driver whose name is pressed.
- A coloured row keeps its colour under the mouse pointer.

OT & Multiple Duties, now in the same three steps:

1. One line per site: red, orange, brown and drivers, plus All sites. The Site selection narrows the lines; one site opens by itself.
2. Pressing a number lists those drivers, one row each (red, orange, brown, cases in the selected dates, OT in the month and year), with each case listed under them.
3. Pressing a driver's name opens the same month-wise history.

- Log book (VLB, ELB, LMV) is one selector at the top instead of a split in every block. A duty saved in two log books still counts under both.
- Driver category is a column of the drivers list; the separate category table and the "earlier repeats" list are removed from the screen. `GET /api/reports/manpower/ot-history` remains but the page no longer calls it.

All Manpower & OT pages:

- The table's own From / To date bar is switched off (`recordDateFilter={false}`); the dates at the top of the page are the only date control.
- **Manpower Data Review** lists saved cards with a data problem that affects the counts, for the MIS team to correct. On the attendance and OT pages it is one line ("31 saved cards need correction") that opens the list; on Manpower by Category and Shift Performance it stays in full.
- A site is shown under one properly written name (Shift Master first, then batches, then cards). A stored lower-case key such as "jayant ob" appears only when no better spelling exists, and the Site selector lists each site once.

Data: `GET /api/reports/manpower` adds `attendanceShifts` (`siteKey`, `date`, `shift`, `state` = `none` | `vlb_open` | `lmv_open` | `elb_open` | `closed` | `not_due`, `batch`) and `employeeKey` on `attendanceEquipment` rows; the batch read now includes `shift` and `stage`. `GET /api/reports/manpower/ot-drivers` adds `duties` (actual duties per month, saved VLB and ELB cards) and lists every driver of the site, not only flagged ones.

## OT date by shift (10 Nov 2026)

Owner's sketch of 10 Nov 2026 (a marked-up copy of the site summary workbook): site, then date by shift, then drivers, then the driver's red and orange counts for the month and the year.

- An opened site now shows a **date by shift** table between the site lines and the drivers list: one row per selected date, one column per shift (Shift 1 to 3, plus any other shift code found), then Cases and Drivers, and an All dates row when more than one date is selected.
- **A case is placed once, on the date and shift of its first duty** (`startDate`, `startShift` on every `ot` event). Shift 1 with Shift 2 or Shift 3, and all three shifts, sit under Shift 1; Shift 2 with Shift 3 under Shift 2; Shift 3 with the next day's Shift 1 under Shift 3 of the first day. The table therefore adds up to the site's line. This is the same day rule as the month and year counts.
- A case that began in Shift 3 on the evening before the From date is part of the site's line (the report reads one adjoining day), so it gets its own row, marked "night before the selected dates".
- Each box holds a pressable number per colour. Pressing one narrows the drivers list and the case table to that date, shift and colour; the Cases number narrows to the date; the All dates row narrows to a shift. Pressing the same number again, or "Show all dates and shifts", returns to the whole site. The site's drivers are still listed as soon as the site opens.
- The drivers list replaces "OT in <month>" and "OT in <year>" with four columns: Red and Orange in the month, Red and Orange in the year. Brown stays in the driver's history. The colour columns for the selection are named "Red / Orange / Brown in selected dates". Shift Attendance Equipment Wise keeps its two combined OT columns.
- The date-by-shift table is a screen table like the site lines: it has no Generate button. The drivers list and the case table under it export what is selected.
- No new read: the table is built in the page from the cases already loaded.

## Second machine column (10 Nov 2026)

Owner's request on the live "duties by equipment" table of Shift Attendance Equipment Wise.

- A **Second machine** column sits beside Actual duties: equipment-wise duties minus actual duties (128 minus 124 shows 4). It is the number of rows where that equipment was a driver's second machine in the shift.
- Pressing the number lists only those drivers (`actual` false); the title ends with "Second machine only" and Duty note names the machine that carries the actual duty. Pressing it again closes the list.
- Two machines of the same equipment group in one shift are still one row with both door numbers, so they are not part of this number.
