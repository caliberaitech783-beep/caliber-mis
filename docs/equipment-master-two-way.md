# Equipment master: two-way with one OTP

Pulse (pulse.cmll.in) and Pulse-II (pulse-ll.cmll.in) show the same Equipment master, and either one can change it.

## How a change works

1. In either app, open **Masters → Equipment master** and add a record, edit one, delete one, delete selected or all records, or import a sheet.
2. The app shows **Approve Equipment master changes**. Pulse sends **one** six-digit OTP by WhatsApp to all three authorised mobiles: 9850396090, 7828619175 and 9423604667. The message says how many records are added, edited and deleted, and which app asked.
3. An approver reads the code out. Enter it and choose **Verify & apply**. The whole action is applied together, or nothing is applied.
4. Pulse writes the change. Pulse-II pulls the Equipment master straight away when the change came from Pulse-II. Otherwise it picks the change up during its next hourly sync.

The OTP is valid for 10 minutes and can be tried 5 times. Use **Resend OTP** for a new code. **Cancel** changes nothing.

An imported row that matches an existing machine (by serial, asset, registration, door, engine or chassis number) overwrites that machine, as imports always have. It counts as an edit in the OTP message.

## Rules

- Direct writes to `/api/masters/Equipment master` are refused with `409 equipment_otp_required` in both apps.
- In Pulse-II the user needs Equipment master access and the **Pulse Master Sync** MIS menu on their Pulse login. Pulse-II record ids are translated to Pulse ids through `pulse_master_links`. A record Pulse does not know yet is refused: run **Sync all masters** first.
- Pulse records every request and approval in `equipment_master_approvals` and in the Audit Trail. Pulse-II records its own Audit Trail entry too.
- Server-side flows still write the master directly, as before: express transfers, Oracle "Sync drivers & models" and the Pulse master sync.

## Code

| App | Files |
| --- | --- |
| Pulse | `equipment-master-approval.mjs`, `equipment-master-changes.mjs`, `mis-pulse-bridge.mjs` (bridge actions `equipment-changes` and `equipment-changes-verify`), `src/equipment-otp-dialog.mjs` |
| Pulse-II | `server/routes/equipment-master-otp.mjs`, `src/equipment-otp-dialog.mjs` (same file as Pulse) |

Release Pulse first. Until Pulse has the bridge actions, Pulse-II says the Pulse connection update is still being applied, and nothing changes.
