import {fleetDoorKey} from './scan-fleet-door.mjs';
import {cardMachineKey} from './scan-machine-rules.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {tripCardLocation} from './scan-site-match.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';
import {tripEquipmentRequired} from './trip-card-rules.mjs';
export function scanFleetAssignment(rows,draft={},raw={},localDoor='',kind='vehicle',fieldLabel='Door NO'){
 if(!Array.isArray(rows)||!rows.length)throw Error('Pulse fleet verification unavailable. The scan is retained; reconnect Pulse and retry.');
 const door=String(draft.doorText||localDoor||raw.door||'').trim();
 const site=String(draft.location||'').trim();
 if(!door||!site||!/[0-9]/.test(door))throw Error('Enter a readable machine door number and site before Pulse fleet verification. The scan is retained.');
 const key=fleetDoorKey(door,kind);
 // An approved card alias on the Pulse record answers for the written label in either notation.
 const aliasKeys=row=>(Array.isArray(row.cardAliases)?row.cardAliases:[]).flatMap(alias=>[fleetDoorKey(alias,kind),cardMachineKey(alias,'equipment')]).filter(Boolean);
 const identifiers=row=>[row.door,row.doorNo,row.equipmentDoorNo,equipmentDoorNumber(row),...(Array.isArray(row.cardAliases)?row.cardAliases:[])].filter(Boolean);
 const exactKey=value=>String(value||'').trim().toUpperCase().replace(/\b(?:TATA|TA|T)\s*(?=\d)/,'TPC').replace(/\s+/g,'').replace(/[·–—(/]/g,'-').replace(/-+/g,'-');
 const eligibleRows=rows.filter(row=>{
  const category=String(row.category||row.equipmentCategory||row.kind||'').trim().toLowerCase();
  // V29 on a trip can mean VPC29, but a V29 vehicle is a separate asset.
  if(kind==='equipment'&&['vehicle','vehicles'].includes(category))return false;
  return true;
 });
 // A literal Equipment Master door always wins over a learned alias. This keeps
 // distinct machines such as DEMO19 and DEMO25 separate even if DEMO19 carries
 // an obsolete DE25 alias.
 const realMatches=eligibleRows.filter(row=>fleetDoorKey(row.door||row.doorNo||row.equipmentDoorNo||equipmentDoorNumber(row),kind)===key);
 const broadMatches=realMatches.length?realMatches:eligibleRows.filter(row=>aliasKeys(row).includes(key));
 const requestedExact=exactKey(door),hasSuffix=/^[A-Z]+\d+-[^-]+$/.test(requestedExact);
 const exactMatches=hasSuffix?broadMatches.filter(row=>identifiers(row).some(value=>exactKey(value)===requestedExact)):[];
 const candidates=hasSuffix?exactMatches:broadMatches;
 const currentLocation=row=>row.currentLocation||row.location||row.site||'';
 const selectedSite=canonicalSiteName(tripCardLocation(site));
 const isAtSite=row=>canonicalSiteName(tripCardLocation(currentLocation(row)))===selectedSite;
 // Short equipment numbers can be reused at different mines.
 const siteMatches=kind==='equipment'?candidates.filter(isAtSite):[];
 const matches=siteMatches.length?siteMatches:candidates;
 if(matches.length>1){
  const records=matches.map(row=>{
   const identifier=row.door||row.doorNo||row.equipmentDoorNo||equipmentDoorNumber(row)||'No door number';
   const location=row.currentLocation||row.location||row.site||'Unassigned';
   return identifier+' ('+location+(row.id!=null?', record '+row.id:'')+')';
  });
  throw Error('Pulse duplicate identifier: '+fieldLabel+' contains '+door+', which matches '+matches.length+' Equipment Master records: '+records.join(', ')+'. Select the correct full equipment identifier or correct the matching records in Pulse, then recheck. The scan is retained.');
 }
 if(matches.length&&isAtSite(matches[0]))return null;
 const current=matches.length?currentLocation(matches[0]):'';
 return {door,selectedSite:site,pulseSite:matches.length?current||'Unassigned':'Not registered',reason:matches.length?'transfer-required':'unknown-machine',message:'Card kept for review: machine '+door+' is '+(matches.length?'assigned in Pulse to '+(current||'no site'):'not registered in Pulse')+'; selected mine: '+site+'. '+(matches.length?'Complete its transfer':'Register the machine and assign it')+' in Pulse, then recheck this card. The original scan and draft are retained.'};
}

// Include the full label so a correction to the serial triggers a new check.
const fleetReviewLabel=value=>String(value||'').trim().toUpperCase();
export function scanFleetSignature(draft={}){return JSON.stringify([4,draft.bookDate||'',fleetReviewLabel(draft.doorText),canonicalSiteName(tripCardLocation(draft.location||'')),(draft.trips||[]).map(row=>tripEquipmentRequired(row,draft.timeMode)?fleetReviewLabel(row.equipmentName):null),(draft.scanMachineSummary||[]).map(row=>fleetReviewLabel(row.equipmentName))]);}
export function scanFleetIssues(rows,draft={},raw={},localDoor=''){
 const entries=[{door:draft.doorText||localDoor||raw.door,field:'doorText',kind:'vehicle',label:'Door NO'},...(draft.trips||[]).flatMap((row,i)=>tripEquipmentRequired(row,draft.timeMode)?[{door:row.equipmentName,field:'trips.'+i+'.equipmentName',kind:'equipment',label:'Trip Details, row '+(i+1)+' (Equipment name)'}]:[]),...(draft.scanMachineSummary||[]).map((row,i)=>({door:row.equipmentName,field:'scanMachineSummary.'+i+'.equipmentName',kind:'equipment',label:'Machine-wise summary, row '+(i+1)+' (Equipment name)'}))];
 const issues=new Map();for(const entry of entries){if(!String(entry.door||'').trim())continue;const issue=scanFleetAssignment(rows,{doorText:entry.door,location:draft.location},{},'',entry.kind,entry.label);if(!issue)continue;const key=fleetDoorKey(entry.door,entry.kind);if(!issues.has(key))issues.set(key,{...issue,key,fields:[]});issues.get(key).fields.push(entry.field);}
 return [...issues.values()];
}
export function scanFleetBlockingMessage(card){
 const review=card.raw_fields?.fleetReview;
 if(!review||review.signature!==scanFleetSignature(card.draft))return 'Pulse equipment site verification pending.';
 if(review.error)return review.error;
 return review.issues?.length?'Equipment not assigned to this site: '+review.issues.map(issue=>issue.door).join(', ')+'. Resolve the equipment review before saving.':'';
}

