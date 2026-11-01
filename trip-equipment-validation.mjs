import {canonicalSiteName} from './site-location.mjs';
const clean=v=>String(v??'').trim(),key=v=>clean(v).toUpperCase().replace(/[ ._-]/g,'');
const families={V:'Vpc',VOLVO:'Vpc',VPC:'Vpc',T:'Tpc',TA:'Tpc',TATA:'Tpc',TPC:'Tpc',L:'Lpc',LPC:'Lpc',S:'Spc',SPC:'Spc'};
const parse=v=>{const m=key(v).match(/^([A-Z]*)([0-9]+)$/);return m?{prefix:m[1],number:String(Number(m[2]))}:null;};
const labels=r=>[r.door,r.doorNo,r.equipmentName,r.equipment,r.name].filter(Boolean);
export function resolveTripEquipment(row={},assets=[],location=''){
 const original=clean(row.equipmentName||[row.machine||row.m,row.equipmentNo||row.no].filter(v=>v!=null).join(' ')),parsed=parse(original),site=canonicalSiteName(location);
 if(!site)return {error:'Select a location before matching trip equipment.'};
 if(!original)return {error:'Enter the loading equipment.'};
 if(parsed?.prefix==='U'&&assets.some(r=>labels(r).some(v=>/^U/i.test(clean(v)))))return {error:'U cannot be interpreted as V: equipment beginning with U exists in the master. Check the card.'};
 const family=parsed&&(parsed.prefix==='U'?'Vpc':families[parsed.prefix]);
 const matches=assets.filter(r=>!r.sourceMissing&&canonicalSiteName(r.currentLocation||r.site||r.location)===site&&labels(r).some(v=>{if(key(v)===key(original))return true;const p=parse(v);return parsed&&p&&parsed.number===p.number&&(!parsed.prefix||family&&families[p.prefix]===family);}));
 const unique=[...new Map(matches.map(r=>[String(r.id??JSON.stringify(r)),r])).values()];
 if(unique.length!==1)return {error:unique.length?'Multiple equipment records match '+original+' at '+location+'. Select the correct equipment.':original+' is not assigned to '+location+'. Check the machine and number.'};
 const record=unique[0],label=labels(record).map(parse).find(p=>p&&families[p.prefix]);
 return {equipmentName:label?families[label.prefix]+' '+label.number:clean(labels(record)[0]),equipmentId:String(record.id),originalEquipmentName:clean(row.originalEquipmentName||row.equipmentNotation?.original||original)};
}
export function validateTripEquipment(draft={},assets=[]){const issues={},result={...draft};for(const field of ['trips','scanMachineSummary'])result[field]=(draft[field]||[]).map((row,i)=>{const match=resolveTripEquipment(row,assets,draft.location);if(match.error){issues[field+'.'+i+'.equipmentName']=match.error;return row;}return {...row,...match};});return {draft:result,issues};}
