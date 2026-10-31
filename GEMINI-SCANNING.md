# Pulse-II Gemini card scanning

VLB Scan and ELB Scan use `gemini-3.1-flash-lite` with one successful extraction request per captured card. The request contains the original image and three detail views from that same capture. Transient transport/quota failures have bounded retries; there is no provider/model substitution when Gemini is enabled.

The Pulse-II deployment workflow configures `GEMINI_API_KEY` and `MIS_GEMINI_API=true` on **caliber-mis-783** only. The existing encrypted GitHub Actions secret is `MIS_GEMINI_API_KEY`. Key material is never included in a response, homepage, browser storage, repository, or deployment log. Users reuse the server configuration. The local Windows setup can continue using its current-user DPAPI key.

PDF/image uploads go directly to the server extraction queue. USB scanning requires the local Windows WIA connector: it captures images and transfers them to the online queue, without a duplicate local Gemini call. The connector enumerates available scanners without a Brother preference. A compatible installed WIA driver is required; other brands still need physical capture testing.

VLB retains header, HMR/KMR, machine summary and individual trip rows. ELB retains equipment/operator/job-card/HMR fields and does not invent vehicle rows or KMR. Submitting a VLB through ELB produces a specific wrong-page error. Original responses and reported token usage remain separate from manual edits. Cache entries are scoped by image, type, model and prompt revision. The user-confirmed S1NN door separator is rendered S/NN; the original response remains available server-side.

The review view initially shows missing, invalid or flagged fields. Show all values reveals the complete editable form. Hidden values remain in the full draft saved by the existing API. Human confirmation, validation, approval and final upload remain required. VLB/ELB records and counts remain separate. Existing manual forms and formulas are unchanged.

Release checks include focused tests, npm test and npm run build. Real VLB scans were visually compared locally, including 68 trip-time cells across two cards. This is not a human-approved accuracy benchmark, and no real ELB job-card sample was available for an accuracy measurement. Detail views increase input-token usage. Physical scanning requires testing on the actual installed scanner/driver.

Queue behaviour: online Gemini scanning uses two card workers with atomic PostgreSQL claims. Request starts (including retries) share the four-second rate gate; at most eight distinct images are admitted by the reader. A transient failure retries once, with the reason shown on the card. Identical in-flight images share one API request. The original scan and all extraction fields remain unchanged; model response latency can still vary. Per-response elapsed time, total retry time, attempt count and reported token usage are retained in extraction metadata.

HTTP 402 is a non-transient Google AI project billing rejection. Enable billing for the project that owns the configured key, or replace the `MIS_GEMINI_API_KEY` GitHub Actions secret with a key from a billed project and redeploy. The failed card image is retained; use **Retry OCR** after billing/key configuration is healthy. Repeated retries before that change cannot succeed and are intentionally not automatic.
