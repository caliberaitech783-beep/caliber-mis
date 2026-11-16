// Canonical reporting labels only: never merge assets, rewrite identifiers,
// or treat different punctuation/plurals as the same equipment group.
export function normalizeEquipmentGroup(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

// The name a report shows for a machine's group in the Equipment master (OT & Multiple Duties, Shift Attendance,
// Trip Timing): spelling differences ("Water Tanker" / "WATER TANKER") become one name; the master is never rewritten.
export const NO_EQUIPMENT_GROUP = 'Group missing in master';
export function equipmentGroupName(value) {
  const name = normalizeEquipmentGroup(value);
  return !name || name.startsWith('UNRESOLVED ') ? NO_EQUIPMENT_GROUP : name.toLowerCase().replace(/[a-z]+/g, word => /[aeiouy]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word.toUpperCase());
}

export function equipmentGroupValue(record = {}, fallback = '') {
  return normalizeEquipmentGroup(record.group) || normalizeEquipmentGroup(record.equipmentGroup) || fallback;
}
