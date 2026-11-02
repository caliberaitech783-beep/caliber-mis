import {assetBookKind} from './equipment-kind.mjs';
import {canonicalSiteName} from './site-location.mjs';
const clean=v=>String(v??'').trim(),key=v=>clean(v).toUpperCase().replace(/[ ._-]/g,'');
const families={V:'Vpc',VOLVO:'Vpc',VPC:'Vpc',T:'Tpc',TA:'Tpc',TATA:'Tpc',TPC:'Tpc',L:'Lpc',LPC:'Lpc',S:'Spc',SPC:'Spc'};
// Parse before removing separators: the trailing serial is not part of the door number.
const parse=v=>{const m=clean(v).toUpperCase().match(/^([A-Z][A-Z ._]*?)?[ ._\/-]*([0-9]+)(?:\s*[-·–—(/]\s*[^\r\n]+)?$/);return m?{prefix:key(m[1]||''),number:String(Number(m[2]))}:null;};
const labels=r=>[r.door,r.doorNo,r.equipmentName,r.equipment,r.name].filter(Boolean);
// Matching also accepts approved card aliases; display labels stay the real master label.
const matchLabels=r=>[...labels(r),...(Array.isArray(r.cardAliases)?r.cardAliases.filter(Boolean):[])];
export function resolveTripEquipment(row={},assets=[],location='',{anySite=false}={}){
 const original=clean(row.equipmentName||[row.machine||row.m,row.equipmentNo||row.no].filter(v=>v!=null).join(' ')),parsed=parse(original),site=canonicalSiteName(location);
 if(!site)return {error:'Select a location before matching trip equipment.'};
 if(!original)return {error:'Enter the loading equipment.'};
 // Vehicle doors (for example T11 and S44) cannot identify loading equipment.
 const equipment=assets.filter(record=>assetBookKind(record)==='equipment');
 // An explicit dropdown choice is identified by its master ID, not its OCR alias.
 if(row.equipmentSource==='master-selection'){
  const record=equipment.find(r=>String(r.id)===String(row.equipmentId));
  if(!record||record.sourceMissing||!anySite&&canonicalSiteName(record.currentLocation||record.site||record.location)!==site)return {error:'Selected equipment is no longer available at '+location+'. Select equipment registered at this site.'};
  const label=labels(record).map(parse).find(p=>p&&families[p.prefix]);
  return {equipmentId:String(record.id),equipmentName:label?families[label.prefix]+' '+label.number:clean(labels(record)[0]),originalEquipmentName:clean(row.originalEquipmentName||row.equipmentNotation?.original||original),...(anySite?{equipmentSite:clean(record.currentLocation||record.site||record.location)}:{})};
 }
 // UP registrations are vehicle identifiers, not a U-type machine code.
 if(parsed?.prefix==='U'&&equipment.some(r=>labels(r).some(v=>parse(v)?.prefix==='U')))return {error:'U cannot be interpreted as V: a U-type machine code exists in the master. Check the card.'};
 const family=parsed&&(parsed.prefix==='U'?'Vpc':families[parsed.prefix]);
 const matches=equipment.filter(r=>!r.sourceMissing&&(anySite||canonicalSiteName(r.currentLocation||r.site||r.location)===site)&&matchLabels(r).some(v=>{const p=parse(v);if(parsed&&p)return parsed.number===p.number&&(!parsed.prefix||parsed.prefix===p.prefix||family&&families[p.prefix]===family);return key(v)===key(original);}));
 const selected=clean(row.equipmentId),selectedMatches=selected?matches.filter(r=>String(r.id)===selected):[];
 // Retain a valid equipment identity independently of the vehicle door number.
 const unique=[...new Map((selectedMatches.length?selectedMatches:matches).map(r=>[String(r.id??JSON.stringify(r)),r])).values()];
 if(unique.length!==1)return {error:unique.length?'Multiple equipment records match '+original+(anySite?'':' at '+location)+'. Select the correct equipment.':original+(anySite?' is not in the Equipment master at any site.':' is not assigned to '+location+'.')+' Check the machine and number.'};
 const record=unique[0],label=labels(record).map(parse).find(p=>p&&families[p.prefix]);
 return {equipmentName:label?families[label.prefix]+' '+label.number:clean(labels(record)[0]),equipmentId:String(record.id),originalEquipmentName:clean(row.originalEquipmentName||row.equipmentNotation?.original||original),...(anySite?{equipmentSite:clean(record.currentLocation||record.site||record.location)}:{})};
}
export function validateTripEquipment(draft={},assets=[],options={}){const issues={},result={...draft};for(const field of ['trips','scanMachineSummary'])result[field]=(draft[field]||[]).map((row,i)=>{const match=resolveTripEquipment(row,assets,draft.location,options);if(match.error){issues[field+'.'+i+'.equipmentName']=match.error;return row;}return {...row,...match};});return {draft:result,issues};}
