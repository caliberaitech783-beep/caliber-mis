import {fleetPopulationReports} from './fleet-population.mjs';
import {canonicalSiteName,equipmentSiteName} from './site-location.mjs';
import {equipmentGroupValue} from './equipment-group.mjs';

// Compares the equipment list behind the Equipment Deployment report (the Pulse-II copy) with the
// equipment list read from Pulse at the same moment. Two views of the same difference:
//  counts   - one line per equipment group and site where the two populations differ;
//  machines - the machines that explain it (missing on one side, or at a different site or group).
export const MISMATCH_KINDS={
 'missing-in-pulse-ii':'In Pulse, not in Pulse-II',
 'missing-in-pulse':'In Pulse-II, not in Pulse',
 'site-differs':'Site differs',
 'group-differs':'Equipment group differs',
};

const text=value=>String(value??'').trim();
const identityKey=value=>text(value).toLowerCase().replace(/[^a-z0-9]/g,'');
const machineKeys=asset=>[asset.chassis,asset.chassisNo,asset.door,asset.registration,asset.reg].map(identityKey).filter(Boolean);
const siteOf=asset=>text(equipmentSiteName(asset)||asset.siteName);
const groupOf=asset=>equipmentGroupValue(asset,text(asset.equipment)||'Unclassified');
const describe=asset=>({door:text(asset.door||asset.equipmentName),chassis:text(asset.chassis||asset.chassisNo),
 registration:text(asset.registration||asset.reg),make:text(asset.make),model:text(asset.model||asset.modelNo)});

function countDifferences(localAssets,pulseAssets,locations){
 const local=fleetPopulationReports({assets:localAssets,locations,capacities:[]});
 const pulse=fleetPopulationReports({assets:pulseAssets,locations,capacities:[]});
 const pulseByGroup=new Map(pulse.deployment.map(row=>[row.equipment,row.population]));
 const groups=[...new Set([...local.deployment,...pulse.deployment].map(row=>row.equipment))];
 const localByGroup=new Map(local.deployment.map(row=>[row.equipment,row.population]));
 const rows=[];
 for(const equipment of groups)for(const site of local.sites){
  const pulseII=localByGroup.get(equipment)?.[site.key]||0,inPulse=pulseByGroup.get(equipment)?.[site.key]||0;
  if(pulseII!==inPulse)rows.push({equipment,site:site.label,siteKey:site.key,pulseII,pulse:inPulse,difference:pulseII-inPulse});
 }
 return rows;
}

// localAssets: Pulse-II equipment records; each may carry pulseId, the Pulse record it is linked to.
// pulseAssets: Pulse equipment records, each with its Pulse id.
export function compareEquipmentWithPulse({localAssets=[],pulseAssets=[],locations=[]}){
 const local=localAssets.filter(asset=>!asset.sourceMissing);
 const siteLabels=new Map(locations.map(site=>[canonicalSiteName(site),site]));
 const known=site=>siteLabels.has(canonicalSiteName(site));
 const byPulseId=new Map(),byKey=new Map(),matched=new Set();
 for(const asset of local){
  if(text(asset.pulseId))byPulseId.set(text(asset.pulseId),asset);
  for(const key of machineKeys(asset))if(!byKey.has(key))byKey.set(key,asset);
 }
 const machines=[];
 const add=(kind,asset,detail)=>machines.push({kind,label:MISMATCH_KINDS[kind],...describe(asset),...detail});
 for(const source of pulseAssets){
  const twin=byPulseId.get(text(source.id))||machineKeys(source).map(key=>byKey.get(key)).find(found=>found&&!matched.has(found));
  if(!twin||matched.has(twin)){
   if(known(siteOf(source)))add('missing-in-pulse-ii',source,{pulseSite:siteOf(source),pulseIISite:'',pulseGroup:groupOf(source),pulseIIGroup:''});
   continue;
  }
  matched.add(twin);
  const pulseSite=siteOf(source),pulseIISite=siteOf(twin),detail={pulseSite,pulseIISite,pulseGroup:groupOf(source),pulseIIGroup:groupOf(twin)};
  if(!known(pulseSite)&&!known(pulseIISite))continue;
  if(canonicalSiteName(pulseSite)!==canonicalSiteName(pulseIISite))add('site-differs',twin,detail);
  else if(detail.pulseGroup!==detail.pulseIIGroup)add('group-differs',twin,detail);
 }
 for(const asset of local)if(!matched.has(asset)&&known(siteOf(asset)))
  add('missing-in-pulse',asset,{pulseSite:'',pulseIISite:siteOf(asset),pulseGroup:'',pulseIIGroup:groupOf(asset)});
 const order=Object.keys(MISMATCH_KINDS);
 machines.sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind)||(a.pulseIISite||a.pulseSite).localeCompare(b.pulseIISite||b.pulseSite)||a.door.localeCompare(b.door));
 const counts=countDifferences(local,pulseAssets,[...siteLabels.values()]);
 return {matches:!machines.length&&!counts.length,pulseIITotal:local.filter(asset=>known(siteOf(asset))).length,
  pulseTotal:pulseAssets.filter(asset=>known(siteOf(asset))).length,counts,machines,
  byKind:Object.fromEntries(order.map(kind=>[kind,machines.filter(machine=>machine.kind===kind).length]))};
}

// One short text for the pop-up notice, Telegram and WhatsApp. Machine lines are capped so a large
// difference still fits one message; the report screen always carries the full list.
export function equipmentMismatchMessage(result,{limit=15,checkedAt=''}={}){
 if(result.matches)return 'Equipment list check: Pulse-II and Pulse match ('+result.pulseIITotal+' machines).';
 const lines=['Equipment list mismatch: Pulse-II '+result.pulseIITotal+' machines, Pulse '+result.pulseTotal+' machines.'];
 for(const [kind,label] of Object.entries(MISMATCH_KINDS))if(result.byKind[kind])lines.push(label+': '+result.byKind[kind]);
 for(const machine of result.machines.slice(0,limit)){
  const where=machine.kind==='site-differs'?'Pulse-II '+machine.pulseIISite+' / Pulse '+machine.pulseSite
   :machine.kind==='group-differs'?(machine.pulseIISite+': Pulse-II '+machine.pulseIIGroup+' / Pulse '+machine.pulseGroup)
   :(machine.pulseIISite||machine.pulseSite);
  lines.push('- '+(machine.door||machine.registration||machine.chassis||'Unnamed machine')+' ('+machine.label+'; '+where+')');
 }
 if(result.machines.length>limit)lines.push('...and '+(result.machines.length-limit)+' more. Open Reports > Equipment Deployment for the full list.');
 if(checkedAt)lines.push('Checked '+checkedAt+'.');
 return lines.join('\n');
}
