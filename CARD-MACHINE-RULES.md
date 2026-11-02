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
example body `L21` for the Pulse record `DEMO21-00179`. The first time a
reviewer picks the Pulse record from the loading-row dropdown for such a label,
the application saves the pair as an alias on that equipment record
(`mis_equipment_aliases`, keyed by the Equipment master id). From then on the
written label resolves to that record wherever the matcher runs: scan review
and PDF review, auto-save validation, the Pulse fleet hold ("Equipment missing
or not at this site"), manual VLB entry and every later batch. The row shows
"Written: L21 · Identified: LPC · No. 21 · mapped by saved alias".

Rules: the alias follows the asset, not the site, and only answers at the
asset's current Pulse location. A written label that already names a real door
of another asset at the same site is refused, and if a real door and an alias
both answer the match stays ambiguous and is a review issue. A label that
already matches the asset's own door is never stored. Saved logbooks are not
rewritten. Aliases are listed at `GET /api/equipment-aliases`; an administrator
revokes one with `DELETE /api/equipment-aliases/:id`. Creating or revoking an
alias clears the fleet-check cache of held cards so they are rechecked on the
next batch read. Creation and revocation are written to the audit trail.
