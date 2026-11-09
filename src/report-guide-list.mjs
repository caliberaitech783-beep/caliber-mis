// Report tabs that have an operating manual. Each id has two files under public/guides:
// <id>-en.pdf and <id>-hi.pdf. They are built by scripts/report-guides/build.mjs.
export const REPORT_GUIDE_IDS=[
 'daily','vehicle','equipment','site','trends',
 'door-production','machine-production','meter-continuity','vehicle-trips','loading','shift','timing',
 // The four Manpower & OT tabs ('manpower','employee','attendance','ot') are being rewritten for the screen as changed on 9 Nov 2026; add them back with their PDFs.
 'utilisation','breakdown','meters','missing','scans',
 'tonnage','fuel','cost','targets','billing',
 'vlb-reports','elb-reports'];
export const reportGuide=id=>REPORT_GUIDE_IDS.includes(id)?{en:`/guides/${id}-en.pdf`,hi:`/guides/${id}-hi.pdf`}:null;
