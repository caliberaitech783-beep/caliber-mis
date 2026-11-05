# UI deployment reconciliation

This branch retains the newer deployment implementation from main. It does not
replace production or test workflows, their triggers, production environment,
Azure identities, concurrency, runtime checks, dependency caches or UI rollback.
No GitHub environment approval settings are changed.

The current production workflow deploys pushes to main; test deployment is
manual. Approval rules belong to the GitHub production environment and must be
inspected there. The historical release-tag/reviewer-check workflow from the
older checkout is not restored by this reconciliation.

Existing UI acceleration remains in scripts/ui-delta-plan.mjs,
scripts/deploy-ui-delta.mjs and scripts/release-test-plan.mjs. The deployment
compares with the commit actually serving users. Eligible changes use focused
tests and additive publishing of missing immutable assets, with baseline checks,
rollback evidence and complete-package fallback. Sensitive or unknown changes
retain full validation. Existing OCR and server startup checks remain intact.

The remaining improvement is in .github/workflows/ci.yml: pull-request and
manual validation publish their built UI as a one-day artifact. The layout job
downloads that same UI instead of running a duplicate application build. It runs
only after successful validation. This reduces duplicate runner work; the layout
job now waits for validation, so it is not a promise of shorter PR wall time.

Main-push behavior is preserved: the redundant full validation job stays skipped,
and layout, batch-entry handoff and account-security browser checks still run,
building their own UI as before. Existing dependency caches and check names are
preserved. No frontend, backend, database, login or scanner code is changed.

Merging this branch to main will trigger the current production workflow. This
reconciliation only updates the feature branch; merging and deploying are separate
actions. The older classifier, model-cache helper, test runner and composite
layout action from the initial proposal have been removed because they duplicate
or conflict with the newer implementation.
