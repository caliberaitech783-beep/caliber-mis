# VLB batch card totals

Create Batch and the VLB Scan/Upload workspace show the same batch-wide total: active saved vehicle log-book records linked to the selected parent batch. This includes manual entries and saved Scan/PDF entries, counts each linked record once, and excludes soft-deleted records. Retained deletion snapshots remain available for audit.

The scanner labels its separate image/session breakdown as “Scan entries”. That breakdown can differ from the saved batch total because it describes scan sessions rather than saved log-book records.

Create Batch refreshes with the batch board. The Scan/Upload workspace refreshes its total every fifteen seconds while the tab is on screen and stops while the tab is hidden; saved totals change only when a card is saved. The count endpoint uses the existing batch authentication and site access checks. This change does not rewrite saved records, change batch approval, or alter production approval settings.
