# Scan trip controls during correction

When the Trips section is displayed, the editor keeps the printed serial, loading equipment, trip count
and row delete control together. Header correction filtering does not decide
which trip rows or trip controls are displayed. When the draft uses With time,
loading time, unloading time and the derived read-only GAP are visible in both
full and correction review. The existing Without time behavior still omits time
inputs and GAP; the mode selector is always available to switch back explicitly.
Switching modes retains the draft's existing values and does not infer new times.

The diagnosed source rules hid GAP and the time-mode selector in correction view.
The current source/live bundle already allowed valid equipment and trip times, so
the screenshot alone did not establish the exact cause of those missing controls.
Removing trip-level hidden attributes makes their visibility independent of the
header filter, including older/restrictive correction-filter behavior. Saved
records, scan extraction, equipment matching, permissions, validation and autosave
handlers are unchanged.

Issue-specific review tiles keep their current scope: non-trip tiles can hide the
entire Trips section, while trip/machine-summary review shows its complete rows.

Correction rows use the same responsive timed grid, including GAP. The restored
time selector does not inherit the old horizontal flex basis as a 220px vertical
spacer. Browser checks cover recovery and correction together, a restrictive
header filter, compact/full review, time-mode switching and printed serial
preservation during row deletion at widths from 320 through 1024 pixels.

The layout fixture includes the actual scan-workspace ancestor so hidden
attributes obey the same CSS as the application. It checks the presence of each
trip control instead of checking only whichever labels happen to be visible.
It loads the stylesheet referenced by the built index page; retained historical
hashed stylesheets are not layered over the current build.
