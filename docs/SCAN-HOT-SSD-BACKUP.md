# New scanned cards: Hot Blob storage and SSD copies

Only scans uploaded after activation use the private `scanned-cards` container in
the Central India Standard LRS account `cmllmisscans78320261029`. Every upload
explicitly selects Hot. No lifecycle tier movement or expiry is configured.
Existing cards, database image bytes, folder archives and saved logbooks are not
migrated, overwritten or removed.

The app's system-assigned identity accesses this container. Account-key access
and public Blob access are disabled. Production settings are:

```
MIS_SCAN_BLOB_ENABLED=true
MIS_SCAN_BLOB_ACCOUNT=cmllmisscans78320261029
MIS_SCAN_BLOB_CONTAINER=scanned-cards
```

New uploads are conditional creates, followed by a SHA-256 read-back check.
Only then is the Blob reference inserted into a scan record. PostgreSQL keeps
the image hash, reference, byte count and upload time; new records have a null
database image. Failed uploads create no scan record and can be retried with the
same upload ID. A failed database commit can leave a retained Blob; no automatic
cleanup is permitted. Existing database image reads remain supported.

The backup clock starts with the first new Blob-backed scan. Day 60 makes
days 1–30 eligible; day 90 makes days 31–60 eligible. Ranges are half-open and
measured as fixed 30-day intervals from that first upload. Overdue ranges queue
oldest first. Completing a copy does not change or remove cloud content.

An in-app reminder checks due ranges at sign-in, window focus and hourly while
the app is open. It is not an email, WhatsApp message or background Windows job.
Users must open the app, choose their SSD folder in desktop Chrome or Edge, keep
the drive connected and keep the backup page open. The website cannot verify
that a chosen folder is physically on an SSD, so the user must choose the correct
drive. At 10,000 cards/day, allow roughly 128 GB per 30-day block at the recent
measured average, plus metadata and SSD filesystem overhead.

A backup snapshots the eligible new scan references, review details and saved
logbook values without updating those source records. Files are copied one card
at a time in pages of 100, avoiding loading the complete month's images into RAM.
The browser hashes each downloaded image and rereads each SSD file before
recording verification. Saved values and extraction details are separate JSON
files; a manifest identifies the range and counts. Existing files with matching
hashes are reused. Conflicting files are never overwritten. All files are
rechecked when a pending run is retried, even if an earlier receipt was saved.
Only full-site administrators with backup access can export the complete range.

No restore/import, deletion, cloud expiry or tier changes are part of this feature.
Hot storage continues to grow after each SSD copy. Protect the SSD and its
backup JSON files as operational data.
