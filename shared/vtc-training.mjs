// VTC Training attendance (owner, 25 Nov 2026: "TRAING VTC KA OPTION ALAG COLOUR ME DO AUR USE PRESENT DIKHAO",
// "ISE 0 TRIP KE SATH MAT JODO"). A driver or operator sent for VTC training is present for that date and shift.
// It is its own entry ("VTC Training" beside "Present — 0 trips" on VLB / ELB Manual), never a zero-trip entry:
//  - kept in mis_shift_attendance with the reason VTC_TRAINING_REASON and no machine, so every attendance read
//    (Attendance Batch-wise / Month-wise, the HR feed, the sheet checks) counts it as present;
//  - drawn in its own colour (purple, flag 'training'), listed as "VTC Training", never as "Present — 0 trips" or
//    in a batch's zero-trip list, and never as a zero-trip source.
export const VTC_TRAINING_REASON='VTC Training';
export const TRAINING_FLAG='training';
export const TRAINING_STATUS='Present — VTC Training';
export const TRAINING_FLAG_LABEL='PURPLE — VTC Training';
export const TRAINING_SOURCE='training';
export const isTrainingEntry=entry=>String(entry?.reason??'').trim()===VTC_TRAINING_REASON;
