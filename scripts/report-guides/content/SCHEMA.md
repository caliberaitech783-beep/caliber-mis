# Report manual content: one JSON file per report tab

File name: `<id>.json`, UTF-8, valid JSON. `id` is the report id (`daily`, `vehicle`, `ot`, ...) or `vlb-reports` / `elb-reports`.

```json
{
  "id": "daily",
  "group": "Operations",
  "title": "Daily Operations Summary",
  "menu": "Reports → Operations → Daily Operations Summary",
  "asOf": {"en": "Matches the system as of 10 November 2026", "hi": "10 नवंबर 2026 तक के सिस्टम के अनुसार"},
  "en": {
    "purpose": "Two or three plain sentences: what the report shows and who uses it.",
    "row": "One row is ... (what a single row of the main table stands for).",
    "filters": [["From / To", "what it does"], ["Site", "..."]],
    "screen": [["label or part exactly as on screen", "what it shows / what pressing it does"]],
    "columns": [["Column heading exactly as on screen", "meaning, and how it is worked out if the code shows it"]],
    "notes": ["limits and things to keep in mind, each one sentence or two"],
    "checklist": ["review step 1", "review step 2"],
    "faq": [["question", "answer"]]
  },
  "hi": { "purpose": "...", "row": "...", "filters": [], "screen": [], "columns": [], "notes": [], "checklist": [], "faq": [] }
}
```

Rules

- `asOf` is optional: the date line printed on the cover. Set it when the tab changed after the date the other manuals carry; leave it out otherwise.
- Describe only what the code does. Read the screen component and the rules behind it; do not guess. If something cannot be confirmed from the code, leave it out.
- Quote button names, column headings, filter labels and messages exactly as they appear on screen, in English, in both languages (the screen is in English). In `hi`, write the explanation in simple everyday Hindi (Devanagari) and keep those on-screen names in English letters. Keep VLB, ELB, LMV, OT, HMR, KMR, Shift, Excel, PDF in English.
- `columns` must list every column of the main table(s) in screen order. If a tab has more than one table, prefix the heading with the table name, e.g. `"Review table · Reason"`.
- Plain words, short sentences, no jargon, no marketing words. Write for a site in-charge or MIS clerk.
- No company policy. Say how to find and verify; never say what action management takes.
- No real people. Any example uses "SAMPLE DRIVER 01", Employee ID "CMPL90001", door "V9001".
- `en` and `hi` must have the same number of entries in every list, in the same order.
- 3 to 6 checklist steps, 2 to 4 FAQ entries, 2 to 6 notes.
- Common to every report table (do not repeat inside `screen`): the **Generate** button (Download as PDF, Download as Excel, Smart Print), the **Search this report** box and sorting by column heading. The manual template adds these itself.
