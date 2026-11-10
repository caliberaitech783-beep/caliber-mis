// Report tabs that have an operating manual. Each id has two files under public/guides:
// <id>-en.pdf and <id>-hi.pdf. They are built by scripts/report-guides/build.mjs.
export const REPORT_GUIDE_IDS=[
 'daily','vehicle','equipment','site','trends',
 'door-production','machine-production','meter-continuity','vehicle-trips','loading','shift','timing',
 'manpower','employee','attendance','ot',
 'utilisation','breakdown','meters','missing','scans',
 'tonnage','fuel','cost','targets','billing',
 'vlb-reports','elb-reports','fleet-capacity','equipment-deployment'];
export const reportGuide=id=>REPORT_GUIDE_IDS.includes(id)?{en:`/guides/${id}-en.pdf`,hi:`/guides/${id}-hi.pdf`}:null;
