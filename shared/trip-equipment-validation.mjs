import {assetBookKind} from './equipment-kind.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {tripEquipmentRequired} from './trip-card-rules.mjs';
const clean=v=>String(v??'').trim(),key=v=>clean(v).toUpperCase().replace(/[ ._-]/g,'');
const families={V:'Vpc',VOLVO:'Vpc',VPC:'Vpc',T:'Tpc',TA:'Tpc',TATA:'Tpc',TPC:'Tpc',L:'Lpc',LPC:'Lpc',S:'Spc',SPC:'Spc'};
const machinePrefix=value=>{const prefix=key(value);return prefix==='DE'?'DEMO':prefix;};
// Parse before removing separators: the trailing serial is not part of the door number.
const parse=v=>{const m=clean(v).toUpperCase().match(/^([A-Z][A-Z ._]*?)?[ ._\/-]*([0-9]+)(?:\s*[-·–—(/]\s*[^\r\n]+)?$/);return m?{prefix:machinePrefix(m[1]),number:String(Number(m[2]))}:null;};
// When the card includes the master serial suffix, use it to distinguish machines
// that intentionally share the same short code (for example TPC63).
const serialIdentity=v=>{const m=clean(v).toUpperCase().match(/^([A-Z][A-Z ._]*?)[ ._\/-]*([0-9]+)\s*[-·–—(/]\s*([^\r\n]+)$/);if(!m)return '';const prefix=machinePrefix(m[1]),family=families[prefix]||prefix,suffix=key(m[3]);return suffix?key(family)+String(Number(m[2]))+'#'+suffix:'';};
const labels=r=>[r.door,r.doorNo,r.equipmentName,r.equipment,r.name].filter(Boolean);
// Matching also accepts approved card aliases; display labels stay the real master label.
const matchLabels=r=>[...labels(r),...(Array.isArray(r.cardAliases)?r.cardAliases.filter(Boolean):[])];
// Master arrays are replaced on refresh. Index the snapshot once for all trip rows.
const equipmentIndexes=new WeakMap();
function equipmentIndex(assets){
 let index=equipmentIndexes.get(assets);
 if(index)return index;
 const records=assets.filter(record=>assetBookKind(record)==='equipment');
 const byId=new Map(),byNumber=new Map(),byKey=new Map();
 let hasUMachine=false;
 const add=(map,key,entry)=>{
  if(!map.has(key))map.set(key,new Set());
  map.get(key).add(entry);
 };
 for(const [position,record] of records.entries()){
  const id=String(record.id);
  if(!byId.has(id))byId.set(id,record);
  hasUMachine||=labels(record).some(value=>parse(value)?.prefix==='U');
  if(record.sourceMissing)continue;
  const entry={record,position,site:canonicalSiteName(record.currentLocation||record.site||record.location)};
  for(const value of matchLabels(record)){
   const parsed=parse(value);
   if(parsed)add(byNumber,parsed.number,entry);
   add(byKey,key(value),entry);
  }
 }
 index={byId,byNumber,byKey,hasUMachine};
 equipmentIndexes.set(assets,index);
 return index;
}
export function resolveTripEquipment(row={},assets=[],location='',{anySite=false}={}){
 const original=clean(row.equipmentName||[row.machine||row.m,row.equipmentNo||row.no].filter(v=>v!=null).join(' ')),parsed=parse(original),site=canonicalSiteName(location);
 if(!site)return {error:'Select a location before matching trip equipment.'};
 if(!original)return {error:'Enter the loading equipment.'};
 // Vehicle doors (for example T11 and S44) cannot identify loading equipment.
 const equipment=equipmentIndex(assets);
 // An explicit dropdown choice is identified by its master ID, not its OCR alias.
 if(row.equipmentSource==='master-selection'){
  const record=equipment.byId.get(String(row.equipmentId));
  if(!record||record.sourceMissing||!anySite&&canonicalSiteName(record.currentLocation||record.site||record.location)!==site)return {error:'Selected equipment is no longer available at '+location+'. Select equipment registered at this site.'};
  const label=labels(record).map(parse).find(p=>p&&families[p.prefix]);
  return {equipmentId:String(record.id),equipmentName:label?families[label.prefix]+' '+label.number:clean(labels(record)[0]),originalEquipmentName:clean(row.originalEquipmentName||row.equipmentNotation?.original||original),...(anySite?{equipmentSite:clean(record.currentLocation||record.site||record.location)}:{})};
 }
 // UP registrations are vehicle identifiers, not a U-type machine code.
 if(parsed?.prefix==='U'&&equipment.hasUMachine)return {error:'U cannot be interpreted as V: a U-type machine code exists in the master. Check the card.'};
 const family=parsed&&(parsed.prefix==='U'?'Vpc':families[parsed.prefix]);
 const originalKey=key(original);
 const candidates=new Set(equipment.byKey.get(originalKey));
 if(parsed)for(const entry of equipment.byNumber.get(parsed.number)||[])candidates.add(entry);
 const broadMatches=[...candidates].filter(entry=>(anySite||entry.site===site)&&matchLabels(entry.record).some(value=>{
  const label=parse(value);
  if(parsed&&label)return parsed.number===label.number&&(!parsed.prefix||parsed.prefix===label.prefix||family&&families[label.prefix]===family);
  return key(value)===originalKey;
 })).sort((left,right)=>left.position-right.position).map(entry=>entry.record);
 const exactSerial=serialIdentity(original),serialMatches=exactSerial?broadMatches.filter(r=>matchLabels(r).some(v=>serialIdentity(v)===exactSerial)):[];
 const matches=exactSerial?serialMatches:broadMatches;
 const selected=clean(row.equipmentId),selectedMatches=selected?matches.filter(r=>String(r.id)===selected):[];
 // Retain a valid equipment identity independently of the vehicle door number.
 const unique=[...new Map((selectedMatches.length?selectedMatches:matches).map(r=>[String(r.id??JSON.stringify(r)),r])).values()];
 if(unique.length!==1)return {error:unique.length?'Multiple equipment records match '+original+(anySite?'':' at '+location)+'. Select the correct equipment.':original+(anySite?' is not in the Equipment master at any site.':' is not assigned to '+location+'.')+' Check the machine and number.'};
 const record=unique[0],label=labels(record).map(parse).find(p=>p&&families[p.prefix]);
 return {equipmentName:label?families[label.prefix]+' '+label.number:clean(labels(record)[0]),equipmentId:String(record.id),originalEquipmentName:clean(row.originalEquipmentName||row.equipmentNotation?.original||original),...(anySite?{equipmentSite:clean(record.currentLocation||record.site||record.location)}:{})};
}
export function validateTripEquipment(draft={},assets=[],options={}){const issues={},result={...draft};for(const field of ['trips','scanMachineSummary'])result[field]=(draft[field]||[]).map((row,i)=>{const match=resolveTripEquipment(row,assets,draft.location,options);if(match.error){if(field!=='trips'||tripEquipmentRequired(row,draft.timeMode))issues[field+'.'+i+'.equipmentName']=match.error;return row;}return {...row,...match};});return {draft:result,issues};}
