# Card machine notation

The written type/number is interpreted using the section of the card. Matching
is case-insensitive and accepts spaces, dots, slashes and hyphens. `No.` and
`Number` labels are optional. The written number is retained; padded and
unpadded forms can match only when they identify one master record.

| Trip Card header | Vehicle |
|---|---|
| V / Volvo | Volvo |
| E / Eicher | Eicher |
| S / Scania | Scania |
| H / Haulpak / Haulpak Dumper | Haulpak Dumper |

| Trip Card body M + No., and Job Card header | Equipment series/type |
|---|---|
| V / VPC / Volvo | VPC |
| T / TPC / Eicher | TPC |
| S / SPC / Scania | SPC |
| L / LPC / Haulpak / Haulpak Dumper | LPC |
| D / Dozer | Dozer |
| G / Grader | Grader |
| PL / Pay Loader / PayLoader | Pay Loader |
| H / Hydra | Hydra |

The PC series names follow the supplied tables; the full brand aliases above
follow the user's corresponding body-letter mappings. In particular, H means
Haulpak in a vehicle header and Hydra in an equipment/body field.

Examples: `V P C / 019`, `vpc No. 019` and `V19` can identify the same equipment;
`PL 05` and `Pay Loader 05` can identify the same pay loader. A value with no
machine number or no M/type prefix is not guessed.

Header linkage uses the correct vehicle/equipment category and selected site.
Loading rows and machine summaries resolve aliases to the same unique Equipment
Master label. Chassis/model data cannot replace an explicit, different door.
Missing and ambiguous matches remain review issues and cannot be automatically
saved or approved through the scan API. Existing legacy identifiers are still
accepted when they match an explicit master record.

The OCR prompt asks for literal single-letter, multi-letter and full-word input.
The application applies the mapping; the original OCR text, original Gemini
response, image and literal header text remain available. Existing saved
logbooks and already stored scan drafts are not migrated. New extractions use
machine notation version 1 plus body-rule version 2. For new scans H means Hydra; existing drafts without body-rule version 2 retain the earlier H-to-LPC interpretation. Explicitly edited loading rows retain their card’s rule version. No masters,
images or saved business records are created or changed by deployment.

## Saved equipment aliases (card label to Pulse record)

A driver may write a machine on the card as a label Pulse does not use, for
example body `L21` for the Pulse record `DEMO21-00179`. The pair of written
label and Pulse record is an alias, stored in `mis_equipment_aliases` against
the Equipment master id (a Pulse-II overlay; Pulse itself is never written).
An active alias rides on the asset as `cardAliases`, so the written label
resolves to that record wherever the matcher runs: scan and PDF review,
auto-save validation, the Pulse fleet hold ("Equipment missing or not at this
site"), manual VLB and ELB entry, batch stages, extraction header linking and
every later batch. The row shows "Written: L21 · Identified: LPC · No. 21 ·
mapped by saved alias". Saved logbooks are never rewritten; reports resolve
text-only rows through the matcher and the alias table at read time.

### The mismatch box and the OTP rule (EQUIPMENT_ALIAS_OTP)

With `EQUIPMENT_ALIAS_OTP=1` every card-versus-Pulse mismatch is resolved
through the mismatch box and an OTP. The box opens by itself when a scan or PDF
extraction finishes, before card 1, and can be reopened from the review bar
("Equipment mapping"). It works category by category (tipper headers, trip body
equipment, ELB job card headers) and pair by pair: left, the Pulse equipment at
this site not found on any card; right, the written machines not found in
Pulse with row and card counts. Suggestions are ranked by the written number
and never applied automatically. Pairing applies the choice to the batch's
unsaved cards at once as a card-only selection, so saving and locking continue;
only permanence waits. Manual entry offers the same pairing from the door field
when a typed machine has no match.

One OTP per pair. The first route is the equipment mapping approver (an
administrator setting, seeded login NITISH) by Telegram only, with no WhatsApp
fallback; "Resend" is always available after a wrong or lapsed code under the
one-request-per-minute rule, and five wrong entries lock a code. The second
route, "Emergency OTP to site PM", is always visible; the reviewer chooses a
reason (on leave, unwell, not answering, other) and the site Project Managers
receive the code by Telegram, then WhatsApp. PM self-approval is allowed.
Either approval makes the pair permanent and cancels the live code on the other
route. Revoking an alias uses the same two routes. Without the flag the pair is
active at once on the reviewer's choice, and an administrator revokes directly.
When the flag is switched on, aliases that were saved without approval return
to pending and the box offers them again.

### Standing rules

The alias follows the asset, not the site: it answers only at the asset's
current Pulse location and needs no new OTP after a transfer. A written label
may never shadow a real door: creating one that already names another asset's
door at the same site is refused, and on every Pulse snapshot an alias whose
key is now a real door of the same asset is retired silently, while one that
another asset at the site now carries as a real door is suspended, reported by
Telegram to the approver and the MIS managers, and shown again in the box for a
new OTP; meanwhile the matcher reports the key as ambiguous. Creating,
approving, suspending, retiring and revoking are written to the alias history
and the audit trail. The Equipment master shows an ALIAS column with route,
approver and date on hover and a revoke action; an administrator list per site
with full history and the approver setting sits below the table. A weekly
Telegram line to the approver and the MIS managers counts approvals by route
and site and PM self-approvals. Held cards are rechecked whenever an alias
changes.
