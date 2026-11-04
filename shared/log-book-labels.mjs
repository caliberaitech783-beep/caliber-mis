// Display labels only. Persisted keys, readings, units and calculations stay intact.
const labels = new Map([
  ['Printed trip number', 'Tr.Sr.No'], ['PRI trip NO', 'Tr.Sr.No'], ['Trip row', 'Tr.Sr.No'],
  ['Opening KMR', 'OPN KMR'], ['Closing KMR', 'CLO KMR'],
  ['Opening HMR', 'OPN HMR'], ['Closing HMR', 'CLO HMR'],
  ['R engine opening (HMR)', 'R ENG OPN HMR'], ['R engine closing (HMR)', 'R ENG CLO HMR'],
  ['Loading time', 'L. time'], ['Unloading time', 'U. time'],
  ['Loading equipment', 'Equipment'], ['Equipment name', 'Equipment'],
  ['GAP (minutes)', 'GAP (min)'], ['Gap minutes', 'GAP (min)'],
  ['GAP to previous trip (minutes)', 'GAP (min)'], ['Elapsed minutes', 'Elapsed (min)'],
  ['Book no.', 'Book NO'], ['Book number', 'Book NO'],
  ['Door no.', 'Door NO'], ['Door number', 'Door NO'],
  ['Job Card number', 'Job card NO'], ['Job Card no.', 'Job card NO'],
  ['Trip Card / A Form number', 'Trip card NO'], ['A Form no. (Trip Card)', 'Trip card NO'],
  ['A Form / Trip Card number', 'Trip card NO'], ['A-Form No.', 'Trip card NO'],
  ['Marked shift on Trip Card', 'Card shift'], ['Shift hours', 'Shift HRS'], ['Shift hour', 'Shift HRS'],
  ['Work Order', 'WO / Contract'], ['Work order', 'WO / Contract'],
  ['Work order / Contract', 'WO / Contract'], ['Wo.Cont.', 'WO / Contract'],
  ['Total running KMR', 'Total KMR'], ['Running KMR', 'Total KMR'], ['Running KM', 'Total KMR'],
  ['Total working HMR', 'Total HMR'], ['Working HMR', 'Total HMR'], ['Working Hrs', 'Total HMR'],
  ['Availability hours', 'Availability HRS'], ['Available Hrs', 'Availability HRS'],
  ['Running hours', 'Running HRS'], ['Running Hrs', 'Running HRS'],
  ['Breakdown hours', 'BD HRS'], ['BD hours', 'BD HRS'], ['BD Hrs', 'BD HRS'],
  ['Idle hours', 'Idle HRS'], ['Idle Hrs', 'Idle HRS'], ['Scheduled hours', 'Scheduled HRS'],
  ['Residual idle hours', 'Residual idle HRS'], ['No. of trips', 'Trips'],
  ['Job type name', 'Job type'], ['Total hour', 'Total HRS'],
  ['HMR performance hours', 'HMR performance HRS'],
  ['Each shift’s HMR hours', 'Each shift HMR HRS'],
  ['Combined HMR performance hours', 'Combined HMR performance HRS'],
]);

export const compactLogBookLabel = label => labels.get(label) ?? label;

// Older manual rows have no printed serial. Never replace a saved serial with its index.
export function tripSerialNumber(row, index) {
  return row?.rowNumber != null && String(row.rowNumber).trim() !== '' ? row.rowNumber : index + 1;
}
