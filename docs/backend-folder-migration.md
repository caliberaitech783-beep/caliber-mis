# Backend folder migration

## Scope and compatibility

This is a gradual, behavior-preserving reorganization, starting from commit
`6c2b13a`. It does not change database schemas, stored records, API URLs,
permissions, batch rules, scanning, saving or frontend navigation.

Keep `server.mjs` as the root entry point: `npm start` still runs
`node server.mjs`. Keep the existing build and configuration entry points at
the root. Move modules according to their purpose, not their `.mjs` extension.

| Location | Purpose |
| --- | --- |
| `src/` | Frontend components and browser-specific helpers |
| `server/routes/` | Backend HTTP route registration |
| `server/services/` | Backend services and supporting utilities |
| `server/middleware/` | Request/response middleware |
| `server/rules/` (future) | Business rules used only by the backend |
| `shared/` (future) | Modules actually used by both frontend and backend |
| `scripts/` | Build, verification and maintenance tools |
| `test/` | Existing automated tests |
| `docs/` | Maintained guides |

Do not create empty placeholder directories. Existing modules stay at their
current paths until their own dependency review and verification are complete.

## First batch: diagnostics and error handling

| Previous path | New path | Runtime importer |
| --- | --- | --- |
| `client-error-report.mjs` | `server/routes/client-error-report.mjs` | `server.mjs` |
| `system-diagnostics.mjs` | `server/services/system-diagnostics.mjs` | `server.mjs` |
| `server-error-response.mjs` | `server/middleware/server-error-response.mjs` | `server.mjs` |

These three modules have no imports, filesystem paths or browser consumers.
Their contents are unchanged; only references in the server, tests and
documentation move. `src/client-error-report.mjs` is a separate browser module
and remains in place.

An initial literal-import inventory found 302 root `.mjs` files: 108 reachable
from both frontend source and the backend, 16 from frontend source only, 172
from the backend only and six from neither traversal. This is a planning aid,
not proof that a file is unused: computed imports, source-reading tests,
maintenance scripts and deployment commands need a separate reference search.

Both current Azure workflows deploy the complete workspace (`package: .`), so
the new `server/` directory is included. They continue to run the same startup
command. The optional `scripts/stage-production-release.mjs` utility also
includes `server/`, with a packaging regression check for the relocated files.
No workflow, dependency or deployment-setting change is required for this batch.

## Verification and rollout procedure

1. Start a separate `codex/` branch from current `main`; preserve other work.
2. Run the unchanged test suite and record any existing failures.
3. Choose one cohesive group. Check imports, dynamic imports, source-reading
   tests, scripts, deployment references and paths based on `import.meta.url`.
4. Move the files and update references only. Keep logical changes in separate
   PRs. Compare moved file contents against the starting commit.
5. Run the affected tests, full suite, production build and real server-start
   check against a disposable local database. Run existing VLB/ELB layout and
   Manual/Scan/Upload batch-handoff checks. Resolve new failures before release.
6. Require the existing Linux CI checks on the PR. A passing local comparison
   does not replace CI, especially for Windows-specific test failures.
7. Check the current workflows before merging: as of `d533796`, a code merge to
   `main` automatically builds, tests and deploys production. Merge only with
   deployment authorization and passing checks on an up-to-date branch. The
   test-platform workflow is available manually for higher-risk migrations.
8. Verify live health, login, batch selection, manual entry, scan/upload and
   saving after release. If the moved paths fail, roll back the complete
   application release through the approved release process; this batch needs
   no database rollback. Do not assume historical tag-based rollout instructions
   still match the active workflows.

Continue with other backend-only leaf modules after this pilot is verified.
Move shared modules only after checking both browser and server dependency
graphs. Review obsolete documentation separately; do not remove files merely
to reduce the file count.
