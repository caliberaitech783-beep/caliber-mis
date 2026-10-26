# Batch card review

For VLB, consecutive populated detail rows with blank equipment cells inherit
the last clear equipment written above. An unreadable equipment cell or a gap
in printed trip numbers stops continuation. A wholly missing machine summary
is calculated from complete detail rows; a missing summary name is resolved
only when the detail rows identify one machine, and missing counts use matching
detail totals. Explicit written counts and unreadable summary fields remain
for human review. Derived assignments/counts carry provenance in the draft;
the original image and literal Gemini extraction remain available. Calculated
summaries follow detail edits, while explicitly edited summaries are retained.
Completion runs on the server's extraction result and on explicit detail-trip
edits. It never runs in an independent effect against a draft being loaded:
such an effect could overwrite a newly extracted draft with stale blank state.
Use Re-read unapproved cards to recover a retained scan whose draft was affected;
the existing re-extraction merge preserves nonempty manual corrections.
No card is approved or posted automatically.

The left status buttons show counts per card against the entire batch. Orange means data complete, brown means specific validation issues, human confirmation, or manual entries remain, and red means failed/rejected/blank cards. Queued and reading cards are pending, not blank. The middle list is filtered by the chosen category; the right panel contains that selected card's values and original scan.

Orange is readiness, not verified transcription accuracy. Every card must still be explicitly approved. Save all appears only when all cards are complete and approved, with no unsaved corrections. The server locks the batch and validates exact membership, approval revisions, master data, duplicate checks and each card before committing the entire save. Partial saves are rejected. Draft autosave and browser recovery are retained. Online drafts use the existing MIS server storage; these are not exclusively local drafts.

After Save all, Pulse-II archives original PNGs and saved-values.json (full saved values, original extraction, human reviewer and log book references) in its persistent App Service /home volume:

/home/data/caliber-mis/scanned-cards/Trip Card/YYYY-MM-DD/location/batch-id

ELB uses Job Card instead. Date is each card's book date; a batch spanning locations/dates is split into folders. Site folder names are sanitized and suffixed with a stable short hash to avoid collisions. No Gemini key is included. This is an Azure App Service file archive, not a separate Blob Storage account.

An archive failure does not undo already committed log books or report them as unsaved. The UI provides Retry folder archive, and retries reuse the same saved records without duplicating log books. Local test mode cannot enable Azure archiving. Human checks are not automatically marked complete.
