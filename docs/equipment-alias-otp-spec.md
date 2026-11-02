# Equipment alias by OTP: final draft for go-live

Date: 2 November 2026. Scope: VLB (trip card) and ELB (job card) in Pulse-II MIS Workspace.
Status: approved rules, ready to build. Build on the test platform first.

## 1. Problem

Drivers write a machine on the card as a letter and a number, for example body `L21`.
The equipment master in Pulse may call the same machine something else, for example
`DEMO21-00179`. The matcher reads `L21` as LPC 21 and finds no such door at the site,
so the row (or the whole card, for a tipper header) goes on hold. Today the reviewer
picks the machine from the dropdown by hand, on every row, on every card, every day.

## 2. Rules (standing, "for life")

1. Every card-versus-Pulse mismatch of every kind is resolved through the mismatch
   box and an OTP. Kinds: tipper from the trip card header, equipment from the trip
   card body, equipment from the ELB job card header.
2. The box opens by itself as soon as a scan or PDF extraction finishes, before card 1.
   For manual VLB or ELB entry it opens when the operator leaves a machine field that
   does not match.
3. The box works category by category, and inside a category pair by pair. It shows one
   pair at a time. When that pair is approved it vanishes and the next appears. Order:
   tipper headers first, then trip body equipment, then ELB headers.
4. Left side: Pulse equipment at this site not found on any card. Right side: card
   machines not found in Pulse. Suggestions are ranked by the written number but are
   never applied automatically.
5. One OTP per pair. The first approver is always Nitish Kumar Tiwari, login `NITISH`,
   C.ID 5431, by Telegram only. No WhatsApp fallback for him.
6. "Resend to NITISH" is always available after a mistyped or lapsed code, with no cap
   beyond one request per minute. Five wrong entries lock a code; resend issues a new one.
7. "Emergency OTP to site PM" is always visible as a backup. The reviewer decides when
   Nitish cannot be reached (on leave, unwell, asleep, not answering) and must choose a
   reason. It goes to the Project Manager(s) of the batch site, Telegram first then
   WhatsApp, as the release 4 PM OTP does. PM self-approval is allowed.
8. Either approval makes the pair permanent. Approval on one route cancels the live
   code on the other, so a pair is never approved twice.
9. The approved alias follows the asset, not the site. Once `L21` is mapped to
   `DEMO21-00179` at one mine, it applies wherever Pulse places that asset later, with
   no new OTP.
10. The alias appears on the equipment master record in Pulse-II as an ALIAS, so it is
    part of the system and not a scan-screen secret.
11. A written key may never shadow a real door. The real-time check in section 7
    enforces this on every Pulse snapshot.
12. Nothing blocks go-live. A pair is applied to the open batch at once as a card-only
    selection, before any OTP. Saving and locking continue. Only permanence waits.
13. Saved logbooks are never rewritten. Aliases apply to unsaved rows and to reports at
    read time.
14. Revoking an alias uses the same two OTP routes and leaves saved rows untouched.
15. Every create, approve, emergency approve, suspend, retire and revoke is written to
    the batch audit trail and to the alias history.

## 3. The box

```
Equipment mismatch · trip cards vs Pulse
DCH (East) · 01-11-2026 · Shift I (A) · Batch VLB-DCHE-0111-A · 38 cards scanned
Category 1 of 3 · Tippers (trip card header) · 1 pair pending

PULSE TIPPERS AT THIS SITE,              | CARD TIPPERS
NOT FOUND ON ANY CARD                    | NOT FOUND IN PULSE
-----------------------------------------+------------------------------------------
DEMO732-00211  Volvo · at site since ... | V 732  read as Volvo No. 732 · 3 cards

Pair: DEMO732-00211 ⇄ V 732 (3 cards)
applied to this batch · OTP sent to NITISH 14:02
[••••••] [Approve]   [Resend to NITISH]   [Emergency OTP to site PM…]

[Skip this pair]                                       [Skip category]
```

Behaviour:

- Clicking one row on the left and one on the right forms the pair and applies it to
  the batch immediately. "Send OTP to NITISH" is then the primary button.
- On approval the pair vanishes with a one-line confirmation and the next pair in the
  same category appears. When the category is empty the next category opens. When all
  categories are empty the box closes and card review starts.
- "Skip this pair" leaves the rows on the existing per-row dropdown. "Skip category"
  does the same for all pairs in it. The box can be reopened from the review bar.
- Inside a card, a mapped row shows the resolved name with the line
  "Written: L21 · Identified: LPC · No. 21 · mapped by alias (approved by NITISH)".
- The left column lists only equipment whose current Pulse location is this site.
  Equipment that Pulse places at another site stays in the existing transfer hold.
- For ELB headers the left column also shows model and last known meter, because the
  header drives hours and meter readings for that machine.

## 4. The OTP message

```
Caliber Pulse: Equipment mapping approval
Mohit asks to map written machine L21 (LPC · No. 21) to DEMO21-00179 at DCH (East).
Seen on 9 rows across 4 cards in VLB-DCHE-0111-A (01-11-2026, Shift I A).
OTP 482913, valid 10 minutes. Share it only if you approve. Reading out this code is
your approval and is recorded in the batch audit.
```

The emergency message adds "NITISH could not be reached: <reason>".

## 5. Data

New table `mis_equipment_aliases`:

| column | meaning |
|---|---|
| id | uuid |
| equipment_id | Pulse equipment id the alias belongs to |
| kind | `vehicle` or `equipment` |
| written_key | normalised key, for example `LPC21`, `V732` |
| written_text | what was on the card, for example `L21` |
| status | `pending`, `active`, `suspended`, `retired`, `revoked` |
| created_from_batch | batch id, book (`vlb` or `elb`) and site at creation |
| requested_by | MIS login |
| otp_id | approval OTP row |
| approval_route | `nitish` or `site_pm` |
| emergency_reason | required when route is `site_pm` |
| nitish_otp_count | OTPs sent to NITISH before approval |
| approved_by, approved_at | who and when |
| suspended_reason | set by the real-time check |
| revoked_by, revoked_at, revoke_otp_id | revoke history |

Unique: one active alias per (kind, written_key) within the asset's current site.
Two assets may carry the same written key only while they are at different sites.

`mis_vlb_approval_otps` gains purpose `map_equipment` and `revoke_alias`, a
`reference_id` for the alias, and a `route` column.

Trip rows gain `equipmentSource: 'alias'` beside the existing `master-selection` and
OCR sources, with `equipmentNotation {original, resolved}` kept as today.

Settings: "Equipment mapping approver", one login, seeded `NITISH`. Changing it is an
administrator settings edit, not a release.

## 6. Matching

`matchCardMachine` keeps its door index and adds an alias index per kind. For a written
key it returns, in order:

1. the real door at the site, if exactly one;
2. the active alias whose asset is currently at the site, if exactly one;
3. `ambiguous` if a real door and an alias, or two aliases, both answer;
4. `not-found` otherwise.

Validators (`scanEquipmentMatchIssues`, `validateTripEquipment`) accept alias matches so
auto-save and lock are not blocked. Re-reading unsaved cards and reopening a batch apply
current aliases to unsaved rows only.

## 7. Real-time checks on every Pulse snapshot

The fleet sync already runs about once a minute. On each snapshot, for every active
alias:

- Redundant: the asset now has a real door equal to the written key. Retire the alias
  with an audit line. No message.
- Shadowing: another asset at the same site now has a real door equal to the written
  key (rename, new arrival, or the aliased asset transferred into a site that already
  has that door). Suspend the alias at once. The matcher reports the key as ambiguous so
  no card resolves silently. Telegram to NITISH and the MIS manager naming both records.
  The box shows the pair again with the note "also matches real door at this site";
  resolving it is a new OTP.
- Transfer with no collision: nothing to do. The alias follows the asset.

## 8. Equipment master in Pulse-II

The equipment master view in Pulse-II shows an ALIAS column listing active aliases for
each record, with route, approver and date on hover, and a revoke action that uses the
same OTP routes. The alias table is Pulse-II data keyed by Pulse equipment id; Pulse
snapshots do not overwrite it.

Pulse itself (pulse.cmll.in, separate repository) has no alias field and Pulse-II must
never write master records there. Phase 2 is a "card label" field in Pulse fed from this
table, after which Pulse becomes the only source. Until then Pulse-II holds the alias.

## 9. Reports

All grouping moves from the written name to the equipment id, with the written text as
a secondary column. Rows that carry only text (manual entries, legacy logbooks) are
resolved through the matcher and alias table at report time; stored rows are not
changed. Rows that still cannot be resolved stay as their own flagged line. Touched:

- the machine-wise summary block on the card,
- the batch report,
- the meter continuity report,
- the ELB hours reports.

Verify each against a month of real data on the test platform before production.

## 10. Admin and oversight

- Alias list per site: active, suspended, retired, revoked, with full history.
- Weekly Telegram line to NITISH and the MIS manager: mappings approved, by route, by
  site, and how many emergency approvals were self-approved.
- Rules section added to `CARD-MACHINE-RULES.md` so the behaviour is documented in the
  repository.

## 11. Prerequisites before go-live

1. NITISH links Telegram from his own Pulse-II login on the test platform bot, then on
   production. No administrator can do this for him. Until linked the box reports it and
   only the emergency route works.
2. Each site has at least one Project Manager assigned, as the release 4 OTP requires.
3. Test platform run: two VLB batches and one ELB batch with planted mismatches of all
   three kinds, one pair approved by NITISH, one by emergency PM, one revoked, one
   transfer to a site with a colliding door.

## 12. Build order

1. Alias table, matcher integration, validators, with tests.
2. OTP purposes, Telegram-only delivery for the approver, PM emergency route, resend.
3. Box on VLB scan and PDF review, sequential by category and pair.
4. ELB header and manual entry.
5. Real-time snapshot checks and Telegram warnings.
6. Equipment master ALIAS column and revoke.
7. Reports regrouped by equipment id.
8. Admin list, weekly summary, rules document.

Feature flag `EQUIPMENT_ALIAS_OTP`, off in production until the test platform run passes.

## 13. Build notes (2 November 2026)

Built on branch `feature/equipment-alias-otp`. Deviations from the data section:
the alias OTPs live in their own table `mis_equipment_alias_otps` (purpose,
route, reference to the alias) instead of `mis_vlb_approval_otps`, because that
table requires a batch id and manual-entry mappings have none. Alias history is
`mis_equipment_alias_history`. The approver setting is `app_settings` key
`equipment_alias_approver`. Phase 2 (Pulse card-label field) is unchanged.
