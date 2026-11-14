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

## Locks, Pulse reads and the progress poll (8 November 2026)

Automatic saving, Save all and the manual log-book form read the Pulse breakdown
feed once before taking any advisory lock. Inside the lock the saved feed answers
without a remote call, and the master reads use the transaction's own connection
instead of a second pool connection. Automatic saving and Save all hold the scan
lock (709224102) shared, as the manual form already did; deletions still take it
exclusively and so still wait for every writer.

Batch writers lock one site, date and shift (`lockVlbBatchScope`) instead of the
whole `mis_vlb_saved_batches` table, so six sites save, lock and close at the same
time while a save and a close of the same batch still queue behind each other.
Batch deletions and restores keep the whole-table lock, which the scoped writers
hold shared. The scope key is the canonical site, the ISO book date and the shift
code, the same for a saved record and for its batch row.

`GET /api/scan-batches/:id?progress=1` returns identity, status, revision, the
fleet check, the extraction stage and a trip total for each card: a few KB instead
of every draft and extraction text, with no re-validation, draft rewrite or
duplicate scan. The browser reloads the full entry only when that list differs
from the cards on screen. `GET /api/vlb-batches/:id` sends an ETag and answers 304
to the batch board's If-None-Match when the batch has not changed.

The Gemini start gate defaults to 500 ms (120 starts a minute, so five workers
at about 5 s a card are never held back by it); `MIS_GEMINI_MIN_INTERVAL_MS` overrides it. On
349 production cards read on 8 November 2026 the model took 4.8 s a card at the
median, so the earlier 2000 ms gate, not the model, held the whole company to 30
cards a minute.

## Partial entry reads (12 November 2026)

While cards were being read, the scan screen read the whole entry again each time
one card changed (finished reading, fleet check answered, saved). The whole read
re-validates every unsaved card, so an entry of N cards cost about N whole reads
of up to N cards each. On 12 November 2026 `/api/health` showed the Pulse-II
pool at 10 of 10 connections with up to 8 requests waiting while no card was
being read by Pulse-II itself.

`GET /api/scan-batches/:id?cards=<id>,<id>` now runs the same read for the listed
cards only (at most 40, `SCAN_PARTIAL_REFRESH_MAX`) and answers `partial:true`.
The save gate in that answer is still worked out from every card of the entry.
The screen names the cards its 4 s progress poll shows as new or changed, merges
the answer into the cards on screen and leaves every other card untouched.

A card's checks can depend on other cards (duplicates, carried-over meters), so
the whole entry is still read: when the screen is empty, when more than 40 cards
changed in one poll, when a partial answer does not fit, once after reading
settles, and at least every 60 s (`SCAN_FULL_REFRESH_MAX_MS`) while partial reads
continue. Saving a card validates it on the server as before. No production
timing has been measured for this change yet.

## Entry reads reuse unchanged cards (13 November 2026)

The whole reads that remain (opening an entry, the read after reading settles, the
60 s read, every read after a save) still ran about seven queries per unsaved card.
They now load the duplicate candidates and the earlier meter readings of all cards
in three or four queries, and keep each card's draft fill and checks in memory
(`server/rules/scan-check-memo.mjs`). A kept result is reused only while the card,
the entry selection, the master-data revision and the equipment aliases are
unchanged and every lookup it was built from (duplicates, earlier meters) still
gives the same answer; those lookups are asked again from the loaded data on each
read. Saving a card never uses a kept result. `MIS_SCAN_CHECK_MEMO=false` switches
the reuse off.

On the PGlite test database a whole read of a 40-card entry took 291 queries
before; it now takes 57 the first time and 13 while nothing has changed. No
production timing has been measured yet.

Admin > Diagnostics (Speed and freezes) now names the request or job holding each
database connection, and which have held connections longest since the start, so
a full pool can be traced to its cause.

## One picture preparation per card, and where a card's time went (13 November 2026)

History of 12 November 2026, from 1,159 cards in 34 of the day's 100 scan
entries (3,159 cards, seven sites): Gemini answered in 6.1 s at the median and
9.1 s at the 90th percentile, with one request for 1,127 of the cards and almost
no wait at the start gate, so neither the model nor the rate limit held the
queue. Every card carried a recheck (`firstScanFieldRecovery`), always including
the door: each trip card is read by Gemini twice. A site's queue still moved
only about 6 to 18 cards a minute. Jayant's bursts of six or seven entries
(167 to 230 cards within four minutes) took 25 to 40 minutes to drain.

Making the pictures for a read (decode, eight crops, WebP and PNG encoding) is
the one step that runs one card at a time in a reader process, and it ran for
both reads of every card. The reader now keeps the pictures of the first read
for the recheck of the same scan (at most 16 scans, five minutes, released by
the recheck). The recheck is still a fresh Gemini request. Local measurement,
eight cards with two reads each and Gemini replaced by an instant answer:
5.7 s before, 2.2 s after. The engine's own preparation time was not measured
before this change, so the gain in production is expected, not proven.

Each card now records its preparation time (`gemini.prepMs`, `prepWaitMs`,
`prepReused`) and where its reading time went (`raw_fields.scanTiming`:
`queuedMs`, `firstReadMs`, `recheckMs`, `finishMs`, `totalMs`, `finishedAt`,
`workers`), so the next slow day can be explained from the cards themselves.

## Row security round trips and the pool size (14 November 2026)

After the release of 14 November 2026 (`34c39c5`) Pulse-II's pool stayed at 10 of
10 connections with 45 to 95 requests waiting for six minutes while it read no
card itself; a database-backed request took 1.7 to 6.4 s and a static file 0.2 s,
so the wait was for a connection, not for the server or the network.

Production requires row security (`MIS_RLS_ENABLED=true`), and the row-security
wrapper set the request's site scope transaction-locally: every pooled query cost
four round trips (BEGIN, `set_config`, the query, COMMIT) while holding a
connection. The scope is now set at session level once per connection and
remembered (`server/services/row-security.mjs`): a query whose connection already
carries its scope sends only itself. A caller outside a request (a background
job, a backup) sets the trusted empty scope first, so a scope never leaks between
callers; after a ROLLBACK, a failed COMMIT or a refused statement the connection's
scope is set again. `test/row-security.test.mjs` counts the statements and checks
the rows each scope sees on one shared connection.

`MIS_DATABASE_POOL_MAX` (default 10, at most 50) sets how many connections the web
server may hold. It is a setting, not a code change, so it can be raised without
a release once the PostgreSQL server's connection limit has been checked against
every app that shares it. No production timing has been measured for this change.

## Entry reads filled the pool while no card was being read (14 November 2026)

At 14:15 IST `/api/health` showed the Pulse-II pool at 10 of 10 connections with
45 to 103 requests waiting for ten minutes, while every card was being read by
the engines (`reading: 0`). Admin > Diagnostics named the holder: every one of
the ten connections was held by `GET /api/scan-batches/:id`. That label covers
the whole entry read, the `?cards=` partial read and the `?progress=1` poll.

Two causes in the code:

- The scan entry list asked for every listed entry's progress separately to add
  up its trip total, all at once. With a VLB batch selected that is the entries
  of one site, date and shift; on the job-card screen or without a batch it is
  every entry since 1 November, up to 100. One screen opening, and every save,
  delete or reject after it, put up to 100 requests of five to seven queries each
  on the pool at the same moment.
- A whole or partial entry read takes one connection when it starts and holds it
  until every card's fill and checks are done, with no limit on how many run at
  once. Ten people opening entries together left nothing for saves, approvals or
  any other page.

Now:

- `GET /api/scan-batches` returns `trip_total` for every entry from one query
  over the listed entries' cards, counted the way the progress read counts
  (saved log-book trips first, manually deleted, duplicate and removed cards left
  out, unloading-only rows not counted). The screen uses it and asks for an
  entry's progress only when an older server answers without it, during a
  release swap.
- Whole and partial entry reads run through a lane of `MIS_SCAN_READ_SLOTS`
  connections (default 4). A read waits in the server for a slot instead of
  holding a connection; the progress poll stays outside the lane. The lane's
  numbers are under `scanReading.entryReads` in `/api/health` (running,
  waiting, served).
- The progress poll (`?progress=1`) takes one held connection for its five
  queries instead of five separate checkouts, each of which waited its turn
  behind every other request. Polls run through their own lane of
  `MIS_SCAN_PROGRESS_SLOTS` connections (default 4), and tabs asking for the
  same entry with the same site access share one read for two seconds. Its
  numbers are `scanReading.progressReads` in `/api/health`. After the first
  release of this note (15:35 IST) the entry read lane held at 0 to 4 while the
  pool stayed at 10 of 10 with 60 to 138 waiting, so the polls were the next
  holder to bound.
- The pool size setting from the change above (`MIS_DATABASE_POOL_MAX`) is the
  other lever. The scan engines hold 4 connections each (eight engines, 32) on
  the same PostgreSQL server, so compare the server's `max_connections` with
  every app's pool before raising it.

Measured on the PGlite test database only: three whole reads with one slot hold
one connection at a time and all answer. No production timing has been measured
for this change yet; the next scanning day's `/api/health` and Diagnostics
readings will show whether the pool stays free.

## Two polls on every screen filled the pool (14 November 2026, afternoon)

After the entry-read change above, `/api/health` at 15:50 IST still showed the
pool at 10 of 10 with 65 to 125 requests waiting, `reading: 0`, `entryReads`
nearly idle. The health request itself answered in 1 to 3 s behind that queue,
so nothing was holding a connection for long: about 50 short queries a second
were arriving and ten connections could not keep up.

Two polls ran on every signed-in, visible screen regardless of what the user was
doing:

- The remote assistance check (`GET /api/remote-assistance/current`) every 2 s.
  Each call cost the session lookup, an `UPDATE` marking expired assistance
  requests, and the read itself: three queries, almost always answering "no
  request".
- The session message and announcement check (`GET /api/session-messages` and
  `GET /api/announcements/pending`) every 3 s: two requests, four queries.

Together that is about 2.8 queries a second per open screen, so some 18 open
screens fill ten connections by themselves.

Now:

- An idle screen asks about remote assistance every 15 s and switches to every
  2 s only while a request for it exists (pending, approved or active), so a
  user who has approved a session still answers quickly. An administrator's new
  request reaches the user within 15 s instead of 2 s.
- Session messages and announcements are checked every 15 s.
- The expiry `UPDATE` runs at most once every 30 s across every polled request
  (`expireRemoteAssistanceSessionsThrottled` in `server.mjs`); the minute
  cleanup timer runs it as before, and the current-request read skips rows past
  `expires_at` itself, so an unmarked expired request never shows as live.

Expected: about 0.4 queries a second per open screen for these two checks, an
85 percent cut. The per-route numbers that would have named these holders are
on Admin > Diagnostics, which needs a super admin login; this change was made
from the public health figures and the code alone. No production timing has
been measured for it yet.

## What Diagnostics showed, and the first three connection savings (14 November 2026, afternoon)

Admin > Diagnostics (Speed details), 8 minutes after the 15:00 IST release:
14 server freezes in the hour (longest 6.9 s), 4,008 of 4,775 requests slow,
up to 134 requests waiting for the 10-connection pool. Connections held at that
moment: `GET /api/vlb-batches` x3, `GET /api/vlb-batches/:id` x2,
`GET /api/notifications` x1 held for 380 s, `GET /api/scan-batches/:id` x1 for
19.7 s. Most connection time: `GET /api/vlb-batches` 1,224 s in 2,732 uses and
`GET /api/vlb-batches/:id` 742 s in 2,058 uses, both in 8 minutes.

- The notification listener (`LISTEN bdms_notifications`) took its connection
  from the request pool and kept it for as long as the server ran: one of the ten
  connections was never available to a request. It now opens a connection of its
  own (`createNotificationFeed(pool,{connect})`, `server.mjs`).
- Every batch board request looked its actor up in the Users master and read the
  PM trial row. The actor is reused for 10 s per login and the trial answer for
  30 s on the board's reads (`vlbPmTrial(client,{cacheMs})`); any batch write or
  trial activation drops both. Writers still read the trial row directly.

The freezes themselves are not explained by these; the "Recent server freezes"
list on the same page names the requests running during each freeze and is the
next thing to read. No production timing has been measured for this change.

## Eight readers a queue and a 250 ms start gate (15 November 2026)

On 14 November 2026 a 40-card Sasti VLB entry showed `5 reading · 31 waiting`
for most of its life: the cards were being read by Pulse-II itself (not an
engine), and Pulse-II read five cards at once per queue, the figure chosen
before the recheck existed. Every trip card now costs two Gemini answers (the
first read and the door recheck, about 6 s each on 12 November) plus its
finish, so five workers moved a queue at roughly 20 cards a minute, and a
40-card entry took about two minutes of reading after the last upload.

- Pulse-II now reads eight cards at once per queue (`DEFAULT_GEMINI_WORKERS` in
  `server/routes/bulk-card-scanning.mjs`), the figure the engines already used.
  The single shared queue and the per-site lanes (`MIS_SCAN_LANES=sites`) both
  take it; `MIS_SCAN_LANE_CONCURRENCY` still overrides it for site lanes, at
  most 10. Local non-Gemini OCR stays at one worker.
- The shared start gate on one key is 250 ms (240 starts a minute) instead of
  500 ms. Eight workers at two reads of about 6 s each start about 160 requests
  a minute, which the 500 ms gate would have capped at 120. A billed Flash
  project allows far more than 240 requests a minute; an HTTP 429 still widens
  the spacing for that key as before. `MIS_GEMINI_MIN_INTERVAL_MS` overrides it.

Expected, not measured: a queue read by Pulse-II moves about three fifths
faster (eight workers for five) while Gemini's answer time and the per-site
keys are unchanged. Each worker holds a database connection only for its
short progress and completion updates, so the pool cost of three more workers
is small next to the entry reads bounded on 14 November. The next scanning
day's `raw_fields.scanTiming` (`queuedMs`, `workers`) on the cards will show
whether the queue wait fell.

Not changed, and the next lever if the owner wants it: the door recheck sends
the whole card again (all views, full prompt) and Gemini re-transcribes every
trip row, so it costs as much as the first read. A recheck that sends only the
header detail and asks only for the door and site when the first read had no
other problem would cut a clean card's reading time by about a third, but it
changes what the second read confirms, so it waits for the owner's decision.
