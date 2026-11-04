export const MOBILE_NAVIGATION_ITEMS = [
  "Dashboard",
  "Tickets",
  "Masters",
  "Users & employees",
  "Equipment master",
  "Breakdown master",
  "Repair type master",
  "Region master",
  "Vehicle transfers",
  "Hierarchy master",
  "OEM master",
  "WhatsApp Integration",
  "Meta API setup",
  "Daily site-wise report",
  "Daily OEM report",
  "WhatsApp alert history",
  "Reports",
  "Audit Trail",
];

export function normalizeMobileNavigationVisibility(value = {}) {
  return Object.fromEntries(MOBILE_NAVIGATION_ITEMS.map((item) => [item, value?.[item] !== false]));
}

// Menu names double as stored access keys, so display-only renames live here.
export const NAVIGATION_LABELS = {
  "Vehicle Log Book Options":"Vehicle Log Book (VLB)",
  "Equipment Log Book Options":"Equipment Log Book (ELB)",
  "Vehicle Log Book":"VLB Manual",
  "Equipment Log Book":"ELB Manual",
  "Trip Card Bulk Scan":"VLB Scan",
  "Job Card Bulk Scan":"ELB Scan",
  "Pulse Master Sync":"Sync all masters",
  "Users & employees":"Login Details",
  "Employee master":"Employee Master",
  "Daily site-wise report": "Daily site-wise reports",
};

export function navigationLabel(name) {
  return NAVIGATION_LABELS[name] || name;
}
