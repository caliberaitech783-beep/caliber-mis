# Scan review improvements

The PC connector sends original PNG bytes as transferable ArrayBuffers and
uploads them as `image/png`, avoiding base64's approximately one-third size
overhead. It prepares one following page while awaiting the current upload's
acknowledgement; uploads remain ordered with at most two page buffers in flight.
The authenticated endpoint retains its 12 MB / 20 megapixel limits, stable upload
IDs and duplicate protection, and continues accepting existing JSON/base64 clients.
Images are not resized or recompressed. Transfer time still depends on internet
upload speed and server/database response time; extraction is a separate stage.

Capture timing is measured from the local scanner/import job creation to its completion, before upload and Gemini extraction. The UI retains pages, mode and duration with each draft. Old batches have no recorded capture duration.

Detected error percentage counts completed cards with missing/invalid fields, validation conflicts or extraction failures, once per card. Pending and rejected cards are excluded; routine meter handwriting confirmations are excluded. API/extraction failures are also shown separately. This is a validation indicator, not measured transcription accuracy.

Caliber employee ID lookup appears before the header fields, subject to the existing show-only-corrections setting. Extracted values remain in the complete save payload.

Upside-down support uses the same captured original plus overlapping full-height detail columns in both 0 and 180 degree orientations within one Gemini 3.1 Flash Lite request. Original scans remain unchanged. Detail views use high-quality JPEG to limit transfer size. No physical rescan or alternate provider is used. More views can increase latency and token usage. Human review remains required, especially for faint handwriting.

Real-card check (2026-10-24): the same retained VLB card and a 180-degree copy each returned 16 rows, identical literal trip times, date 2026-10-19, door S/14, employee 18861, and the four previously human-confirmed meter values. Gemini reported 7,199 tokens / 22.1 seconds upright and 6,873 tokens / 14.8 seconds inverted. Raw name punctuation, shift formatting, and blank equipment-cell interpretations varied; reconciliation and human review remain necessary. Shift hours and a separate printed total were missing. This is one-card verification, not an overall accuracy measurement.
