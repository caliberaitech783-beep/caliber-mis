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
