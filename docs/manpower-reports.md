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
