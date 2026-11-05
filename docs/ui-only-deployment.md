# Faster UI releases

The test and production workflows automatically choose frontend validation when
the target app's `/api/health` reports a known ancestor of the checked-out commit
and the entire difference contains only frontend files (optionally with docs).
The comparison covers every change since the target's last deployment, including
changes from earlier pushes. A single backend or deployment change selects full
validation.

Eligible files: `index.html`, browser `.js`, `.jsx`, `.ts`, `.tsx`, CSS and image/font
assets in `src`, and CSS/image/font assets in `public`. Shared `.mjs` modules in
`src` are excluded because several also run on the server. Changes to tests,
dependencies, build configuration, workflows, scripts or other runtime files
always use full validation. Renames out of protected paths also use full checks.

Frontend releases still install locked dependencies, build the complete UI,
run frontend/release regression tests and responsive log-book layout checks,
and verify built and live UI/server release identities. They skip the full
backend test suite, database startup rehearsal and repeated OCR model loading.
The OCR model must come from an exact-key cache previously sealed after a full
offline runtime check. Its inputs and all cached file hashes are checked before
using the frontend path. Missing, incomplete or changed caches select full checks.

Full validation remains automatic for unknown/unavailable baselines, rollbacks,
redeploying the same commit and cache misses. The first deployment of these
workflow changes uses full checks. Use **Run workflow → force_full** to explicitly
request the original full validation path. Each release's Actions summary records
the selected mode; the classification step logs why it was selected.

Production still runs only from a `release-*` tag or manual dispatch, waits for
the `production` environment approval, checks that required reviewers remain
configured, and verifies the commit belongs to `main`. Test and production retain
separate identities, target apps and concurrency groups. Gemini settings and
post-deployment health checks remain in both paths.

Both paths deploy the **complete application workspace**, including the runtime
and OCR model cache. This is a validation optimization, not a partial overwrite of
the live application. Azure may still restart the app; zero downtime and a fixed
deployment duration are not promised. Compare Actions step timings after rollout
to measure the actual improvement.

Duplicate work removed:

- A push to `main` runs the test deployment's validation and layout checks rather
  than also launching the independent validation workflow. Pull requests and
  manual validation retain the `build` and `logbook-layout` check names.
- The pull-request layout job downloads the UI built by the `build` job instead
  of building it again. Release layout checks use their job's existing UI build.
- Chromium downloads are cached for layout checks.

Layout tooling is installed in the runner's temporary directory, so it does not
change application dependencies or enlarge the deployed runtime package.

Test and production still build their own complete workspace. Promotion of a
single immutable full-runtime artifact is a separate future optimization; the
existing workflow deliberately avoids transferring that large workspace.
