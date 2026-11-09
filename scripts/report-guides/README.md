# Report operating manuals

Every report tab shows an "Operating manual" bar with two downloads, English and Hindi (`src/report-guide.jsx`). The files are `public/guides/<id>-en.pdf` and `public/guides/<id>-hi.pdf`; the tabs that have one are listed in `src/report-guide-list.mjs`.

## Where the text lives

| Manual | Source |
| --- | --- |
| OT & Multiple Duties (`ot`) | `ot-guide.mjs` (English text, sample data, pictures) and `ot-guide-hi.mjs` (Hindi text) |
| Every other tab | `content/<id>.json`, one file per tab, both languages. Format: `content/SCHEMA.md` |

The 19 tabs drawn by the shared operations screen also get a picture: the real screen code (`src/operations-reports.jsx`) rendered with the sample data in `fixture-operations.mjs`. The OT manual does the same with `src/manpower-reports.jsx`. Pictures therefore follow the screen code; the text does not.

## The rule: a manual changes with its tab

The owner's rule is that an old manual must never stay beside a changed report (see `AGENTS.md`). It is enforced:

- `sources.mjs` names, for every manual, the files that decide what it must say: its own text and the code of its tab.
- `build.mjs` records a fingerprint of those files in `manifest.json` for each manual it builds.
- `test/report-guides.test.mjs` fails when a tab's code or a manual's text no longer matches the fingerprint. The test suite runs before every deployment, so a changed tab cannot go live with its old manual.

## Rebuild after a screen changes

1. Update the text in both languages where the screen changed: the tab's `content/<id>.json`, or `ot-guide.mjs` and `ot-guide-hi.mjs`.
2. `npm run build`
3. `node scripts/report-guides/build.mjs --stale` rebuilds every manual whose tab or text changed. `node scripts/report-guides/build.mjs ot daily` rebuilds named tabs; with no argument it rebuilds all.
4. Commit the changed files in `public/guides` and `manifest.json`.

The build needs Microsoft Edge or Google Chrome on the computer (set `GUIDE_BROWSER` if it is elsewhere). It does not run in CI. `GUIDE_KEEP=1` keeps the HTML pages for checking in a browser.

Several tabs share code (`sources.mjs`), so one change can make several manuals stale: the four Manpower & OT tabs share one file, and the 19 tabs of the shared operations screen share two.

## Adding a tab

Write `content/<id>.json`, add the id to `src/report-guide-list.mjs`, build its two files, commit.

## Keep in mind

- Files under `public/` are served without sign-in. The manuals must contain sample data only: no real employee names, IDs or figures.
- A manual describes the screen as it was when the text was written. When a tab changes, its manual needs the same change.
