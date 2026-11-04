const machineKey = (row = {}, index = 0) => row.assetKey || row.assetId || `${row.kind || "asset"}:${row.door || index}`;

export function fleetMachineSummary(rows = []) {
  const machines = new Map();
  rows.forEach((row, index) => {
    const key = machineKey(row, index);
    const current = machines.get(key) || {
      assetKey: key, site: row.site || "", date: row.date || "", shift: row.shift || "",
      door: row.door || "", kind: row.kind || "", name: row.name || "", model: row.model || "", scannedCards: 0,
    };
    current.scannedCards += Array.isArray(row.cards) ? row.cards.length : 0;
    machines.set(key, current);
  });
  return [...machines.values()];
}

export const fleetScannedCardTotal = (rows = []) => fleetMachineSummary(rows).reduce((total, row) => total + row.scannedCards, 0);
