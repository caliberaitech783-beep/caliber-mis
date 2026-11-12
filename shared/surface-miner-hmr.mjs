export function isSurfaceMiner({equipmentGroup, equipmentName, door} = {}) {
  return [equipmentGroup, equipmentName].some(value => /\bsurface[\s-]*min[eo]r\b|^sm$/i.test(String(value ?? '').trim()))
    || /^sm[\s-]*\d+(?:$|[\s-])/i.test(String(door ?? '').trim());
}

export function splitEquipmentOperatorHmr({employeeId, secondOperatorId, openingHmr, handoverHmr, closingHmr}) {
  const primary = Number(employeeId);
  const secondary = Number(secondOperatorId);
  if (!Number.isSafeInteger(primary) || primary <= 0 || !Number.isSafeInteger(secondary) || secondary <= 0 || primary === secondary) {
    return {error: 'Select two different operators for this shift.'};
  }
  const readings = [openingHmr, handoverHmr, closingHmr];
  if (readings.some(value => !['number', 'string'].includes(typeof value) || !String(value).trim() || !Number.isFinite(Number(value)) || Number(value) < 0)) {
    return {error: 'Enter opening, handover and closing HMR for the shared shift.'};
  }
  const round = value => Math.round(value * 100) / 100;
  const [opening, handover, closing] = readings.map(Number);
  if ([opening, handover, closing].some(value => round(value) !== value)) {
    return {error: 'Enter HMR readings to two decimal places.'};
  }
  if (handover <= opening || closing <= handover) {
    return {error: 'Handover HMR must be above opening HMR and below closing HMR.'};
  }
  const firstHours = round(handover - opening), secondHours = round(closing - handover);
  const totalHours = round(firstHours + secondHours);
  if (totalHours > 8) {
    return {error: 'Combined HMR for both operators cannot exceed 8 hours.'};
  }
  return {secondOperatorId: secondary, handoverHmr: handover, firstHours, secondHours, totalHours};
}
