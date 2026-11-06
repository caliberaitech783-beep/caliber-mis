# VLB batch card totals

Create Batch and the VLB Scan/Upload workspace show the same batch-wide total: active saved vehicle log-book records linked to the selected parent batch. This includes manual entries and saved Scan/PDF entries, counts each linked record once, and excludes soft-deleted records. Retained deletion snapshots remain available for audit.

The scanner labels its separate image/session breakdown as “Scan entries”. That breakdown can differ from the saved batch total because it describes scan sessions rather than saved log-book records.

Both screens refresh their totals every four seconds while open. The count endpoint uses the existing batch authentication and site access checks. This change does not rewrite saved records, change batch approval, or alter production approval settings.
