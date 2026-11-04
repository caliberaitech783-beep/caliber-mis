# Project documentation

[Project introduction](../README.md)

Guides are grouped here to keep the repository root clear. Some documents contain
historical implementation notes or proposed workflows. Check the current source,
tests and `.github/workflows/` before following operational or deployment steps.
Commands and code paths in these guides are relative to the repository root unless
the guide says otherwise; run commands from the repository root, not from `docs/`.

## Setup and architecture

- [Local ERP setup and integration history](ERP-LOCAL.md)
- [Project workflow and historical implementation notes](PROJECT_WORKFLOW.md)
- [Backend folder migration and module organization](backend-folder-migration.md)
- [Module location map](module-locations.json)

## Scanning and review

- [Card machine notation and equipment aliases](CARD-MACHINE-RULES.md)
- [Gemini scanning](GEMINI-SCANNING.md)
- [Scan performance](SCAN-PERFORMANCE.md)
- [Scan review groups](SCAN-REVIEW-GROUPS.md)
- [Equipment alias approval specification](equipment-alias-otp-spec.md)
- [VLB and ELB batch workflow](vlb-elb-batch.md)
- [Scan duplicate go-live plan](scan-duplicate-go-live-plan-2026-11-02.md)

## Operations and releases

- [Backup and recovery guide](BACKUP.md)
- [Scanned-card Blob storage and SSD backup design](SCAN-HOT-SSD-BACKUP.md)
- [MIS administration and support](MIS-ADMIN-SUPPORT.md)
- [Release safety plan](release-safety-plan-2026-11-02.md)
- [Test platform setup](test-platform-setup.md)
- [Request archival](request-archival.md)

## Reports and master data

- [Production reports](production-reports.md)
- [Manpower reports](manpower-reports.md)
- [Breakdown ageing report](bd-ageing-report.md)
- [Employee editing](cdir-employee-edit.md)

Repository instruction files such as `AGENTS.md` and `CLAUDE.md`, when present,
stay in their intended locations; they are not relocated with these guides.
