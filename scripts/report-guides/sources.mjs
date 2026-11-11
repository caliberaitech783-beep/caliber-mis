// Which files decide what a report tab's operating manual must say: the manual's own text and the code of the tab.
// build.mjs records a fingerprint of these files for every manual it builds (manifest.json), and
// test/report-guides.test.mjs fails when a tab or its text has changed since its manual was built.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sharedScreen=['src/operations-reports.jsx','src/operations-report-model.mjs'];
const manpower=['src/manpower-reports.jsx','server/rules/manpower-report.mjs'];
const production=['src/production-reports.jsx','shared/production-report.mjs'];
const fleetPopulation=['src/fleet-population.jsx','shared/fleet-population.mjs'];
const tabCode={'fleet-capacity':fleetPopulation,'equipment-deployment':fleetPopulation,ot:manpower,manpower,'manpower-reconciliation':manpower,employee:manpower,attendance:manpower,'door-production':production,'machine-production':production,
 'meter-continuity':['src/meter-continuity-report.jsx','shared/meter-continuity-report.mjs'],
 'vlb-reports':['src/vlb-batch-reports.jsx','src/vlb-batch-report.jsx','src/scan-batch-reports.jsx','src/scan-batch-report.jsx'],
 'elb-reports':['src/elb-batch-reports.jsx','src/elb-trip-cards.jsx'],
 'batch-status':['src/batch-status-report.jsx','src/batch-status-report.css','shared/batch-status-report.mjs'],
 timing:[...sharedScreen,'src/trip-timing-report.jsx','shared/trip-timing-report.mjs']};
export const guideText=id=>id==='ot'?['scripts/report-guides/ot-guide.mjs','scripts/report-guides/ot-guide-hi.mjs']:['scripts/report-guides/content/'+id+'.json'];
export const guideSources=id=>[...guideText(id),...(tabCode[id]||sharedScreen)];
// Line endings are ignored, so a Windows checkout and the CI checkout agree.
export function fingerprint(root,id){
 const hash=createHash('sha256');
 for(const file of guideSources(id)){hash.update(file+'\n');hash.update(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n?/g,'\n'));}
 return hash.digest('hex').slice(0,16);
}
