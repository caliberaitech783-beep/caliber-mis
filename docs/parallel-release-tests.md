# Parallel full-release tests

Full production validation uses three GitHub-hosted test jobs. Node's native
`--test-shard=1/3`, `2/3` and `3/3` partition the same automatic discovery used by
`npm test`. No hand-maintained test list, exclusion or reduced coverage is added.
New test files automatically participate. Existing environment-gated tests retain
their previous conditions; this change does not enable previously skipped external
integration tests or point any test at production data.

Each worker checks out the workflow's exact commit, restores exact-key dependency
and OCR caches, installs on cache miss, prepares OCR, builds the UI and runs its
shard with the existing concurrency of four. Every worker has its own PostgreSQL
16 container and localhost database. The workers have read-only repository access,
no Azure login, no production environment and no production secrets.

`fail-fast: false` lets all three shards finish even when one fails. The production
job requires successful classification and success of the complete test matrix.
A failed, cancelled or missing shard blocks deployment. Cancelling the workflow
also blocks deployment. Tests still consume runner minutes on three machines;
the improvement is in elapsed time, not necessarily total billed runner time.

The existing release classifier runs first. Eligible UI releases skip the full
matrix and retain the existing focused tests inside the production job. The
classifier's decisions, UI-delta baseline checks and rollback remain unchanged.
Unknown changes and manual dispatch retain full validation.

The production job retains the existing `production` environment and Azure
identity. GitHub environment approval settings, workflow triggers and release
concurrency are unchanged. Only deployment remains behind the production
environment; the read-only test jobs can run before its approval. OCR checks,
startup rehearsal, built/live version checks and complete runtime packaging remain
in the release job. Test-platform and independent CI workflows are unchanged.

This changes release orchestration only. Application code, data, login, scanning,
runtime configuration, package format and Azure restart behavior do not change.
Runner availability, cold caches and uneven shard durations affect the actual time
saved. Compare successful full releases after rollout before claiming a new time.

To return to serial full validation, restore the previous release workflow and
its workflow-contract tests from the parent commit through the normal reviewed
release process. No application or database rollback is required for orchestration.
