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

## PDF upload and extraction pipeline (30 October 2026)

Browser PDF uploads now reuse the first counted PDF for rendering, retain at
most one pre-counted document, and prepare one next card during the current
ordered upload. Already-rendered single PDF pages keep their original PNG bytes;
paired pages and photo inputs retain the existing composition/resolution rules.
Uploads use the binary image endpoint, with metadata in the request header,
rather than JSON/Base64. Full batch validation no longer runs after each page;
background polls coalesce and a fresh batch read runs when uploading finishes.

Repeated master-record reads share a request-local cache during batch validation.
Card checks, permissions and writes are never cached across requests. PNG
normalization and JPEG detail-view encoding use the native asynchronous encoder;
the original scan and full-resolution detail views are retained.

Gemini and server extraction allow three concurrent cards while retaining the
shared four-second request-start gate (at most 15 starts/minute), bounded queue,
retry checks and duplicate suppression. Local non-Gemini OCR remains single
worker by default. This improves batch throughput without changing model or
creating extra extraction calls. Single-card AI latency and network upload speed
still depend on the provider and connection.

A synthetic local two-card image-preparation check retained byte-identical JPEG
detail images. Preparation took 361 ms before and 216 ms after, and the largest
observed event-loop gap fell from 170 ms to 14 ms. These are local preparation
measurements, not an end-to-end production latency guarantee.

## Grayscale WebP scan storage (2 November 2026)

Every new card image is stored as grayscale WebP. The byte sniffing shared by the
browser, the PC connector and the server (`public/scan-image-type.mjs`) recognises
PNG, JPEG and WebP; the upload endpoint, Blob keys (`.webp`), archive and SSD
backup filenames, deletion manifests and the original-scan download follow the
detected type. Existing PNG and JPEG cards are unchanged and still open.

Browser PDF and image uploads render at most 1700 x 2267 px (about 200 dpi on A4)
and encode a grayscale WebP at quality 0.8, falling back to grayscale JPEG where
the browser has no WebP encoder. A WebP that is already within size is uploaded
byte for byte; JPEG inputs are re-encoded. On the synthetic sample page the
rendered output fell from 873 KB (colour JPEG q0.9) to 217 KB.

The local Windows scanner service encodes each WIA page or rendered PDF page once,
natively, as grayscale WebP with a 2400 px long edge (quality 80, stepping down
to stay under 500 KB) before it is retained and queued. The WIA script requests
grayscale from the driver; drivers that refuse keep colour and the service converts.
The connector sends an already-prepared page without decoding it again and only
compresses legacy PNG pages, using the canvas grayscale filter instead of a
per-pixel loop. Full-resolution scanner originals and the per-job PDF are
unchanged on the PC. The published connector package still carries the older
compression code until a new version is packaged.

Gemini receives the stored image in its own format plus six detail views encoded
as WebP (quality 82) instead of JPEG quality 95, which cuts the request body to
roughly a third. Token usage depends on image dimensions, not bytes, so this
reduces upload time rather than model latency. The synthetic 300 dpi page
measured 7.75 MB as colour PNG and 174 KB as grayscale WebP; real paper has less
noise and compresses further. These are local measurements, not production
accuracy results; human review remains required.
