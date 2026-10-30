import {fleetDoorKey} from './scan-fleet-door.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {tripCardLocation} from './scan-site-match.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';
export function scanFleetAssignment(rows,draft={},raw={},localDoor=''){
 if(!Array.isArray(rows)||!rows.length)throw Error('Pulse fleet verification unavailable. The scan is retained; reconnect Pulse and retry.');
 const door=String(draft.doorText||localDoor||raw.door||'').trim();
 const site=String(draft.location||'').trim();
 if(!door||!site||!/[0-9]/.test(door))throw Error('Enter a readable machine door number and site before Pulse fleet verification. The scan is retained.');
 const key=fleetDoorKey(door);
 const matches=rows.filter(row=>fleetDoorKey(row.door||row.doorNo||row.equipmentDoorNo||equipmentDoorNumber(row))===key);
 if(matches.length>1)throw Error('Pulse has duplicate machine identifiers for '+door+'. Resolve the Equipment Master duplicates before saving. The scan is retained.');
 const current=matches[0]?.currentLocation||matches[0]?.location||matches[0]?.site||'';
 if(matches.length&&canonicalSiteName(tripCardLocation(current))===canonicalSiteName(tripCardLocation(site)))return null;
 return {door,selectedSite:site,pulseSite:matches.length?current||'Unassigned':'Not registered',reason:matches.length?'transfer-required':'unknown-machine',message:'Card kept for review: machine '+door+' is '+(matches.length?'assigned in Pulse to '+(current||'no site'):'not registered in Pulse')+'; selected mine: '+site+'. '+(matches.length?'Complete its transfer':'Register the machine and assign it')+' in Pulse, then recheck this card. The original scan and draft are retained.'};
}

export function scanFleetSignature(draft={}){return JSON.stringify([fleetDoorKey(draft.doorText||''),canonicalSiteName(tripCardLocation(draft.location||'')),(draft.trips||[]).map(row=>fleetDoorKey(row.equipmentName||'')),(draft.scanMachineSummary||[]).map(row=>fleetDoorKey(row.equipmentName||''))]);}
export function scanFleetIssues(rows,draft={},raw={},localDoor=''){
 const entries=[{door:draft.doorText||localDoor||raw.door,field:'doorText'},...(draft.trips||[]).map((row,i)=>({door:row.equipmentName,field:'trips.'+i+'.equipmentName'})),...(draft.scanMachineSummary||[]).map((row,i)=>({door:row.equipmentName,field:'scanMachineSummary.'+i+'.equipmentName'}))];
 const issues=new Map();for(const entry of entries){if(!String(entry.door||'').trim())continue;const issue=scanFleetAssignment(rows,{doorText:entry.door,location:draft.location});if(!issue)continue;const key=fleetDoorKey(entry.door);if(!issues.has(key))issues.set(key,{...issue,key,fields:[]});issues.get(key).fields.push(entry.field);}
 return [...issues.values()];
}
export function scanFleetBlockingMessage(card){
 const review=card.raw_fields?.fleetReview;
 if(!review||review.signature!==scanFleetSignature(card.draft))return 'Pulse equipment site verification pending.';
 if(review.error)return review.error;
 return review.issues?.length?'Equipment not assigned to this site: '+review.issues.map(issue=>issue.door).join(', ')+'. Resolve the equipment review before saving.':'';
}

