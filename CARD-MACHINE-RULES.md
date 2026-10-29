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
rule version 1; explicitly edited loading rows also use the rule. No masters,
images or saved business records are created or changed by deployment.
