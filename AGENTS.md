# Deployment procedure

- Complete all changes requested in the current group before starting deployment.
- Test the completed group together. Do not deploy each individual change separately.
- After all requested changes pass their relevant checks, ask the user once for deployment confirmation.
- After confirmation, deploy the complete approved group in one production deployment.
- If the user explicitly requests immediate deployment, follow that instruction without asking for a second confirmation.

# Report operating manuals

Switched off by the owner on 13 November 2026, because building the English and Hindi manual for every report change took too long. This replaces his rule of 9 November 2026.

- Do not write, build or update an operating manual for any report tab or sub tab, in English or Hindi.
- No report tab shows an "Operating manual" bar. The manual PDFs (`public/guides`), their text and build scripts (`scripts/report-guides`) and the check that stopped deployments (`test/report-guides.test.mjs`) were removed.
- A branch that still carries manual changes must drop them before it merges.
- The old manuals and their build scripts stay in git history (last present in commit `af906c6`) if the owner asks for them again.
