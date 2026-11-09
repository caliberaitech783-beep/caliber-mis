# Deployment procedure

- Complete all changes requested in the current group before starting deployment.
- Test the completed group together. Do not deploy each individual change separately.
- After all requested changes pass their relevant checks, ask the user once for deployment confirmation.
- After confirmation, deploy the complete approved group in one production deployment.
- If the user explicitly requests immediate deployment, follow that instruction without asking for a second confirmation.

# Report operating manuals

Owner's rule (9 November 2026): every report tab and sub tab carries its operating manual in English and Hindi, and the manual must change whenever the tab changes. An old manual must never stay beside a changed report.

- A change to a report tab is not complete until its manual is updated in the same change: first the text (`scripts/report-guides/content/<id>.json`, or `ot-guide.mjs` and `ot-guide-hi.mjs` for the OT tab), in both languages, then the two PDFs.
- Rebuild with `npm run build` and then `node scripts/report-guides/build.mjs --stale`. Commit the changed files in `public/guides` and `scripts/report-guides/manifest.json`.
- `test/report-guides.test.mjs` fails, and so the deployment stops, while any tab's code or manual text differs from what its PDF was built from. Do not edit `manifest.json` by hand to get past it.
- A new report tab needs a manual before it goes live: content file, id in `src/report-guide-list.mjs`, both PDFs.
- Manuals are served without sign-in, so they hold sample data only: no real names, employee IDs or figures.
- Details: `scripts/report-guides/README.md`.
