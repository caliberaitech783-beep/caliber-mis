import {fleetDoorKey} from './scan-fleet-door.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {tripCardLocation} from './scan-site-match.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';
export function scanFleetAssignment(rows,draft={},raw={},localDoor=''){
 if(!Array.isArray(rows)||!rows.length)throw Error('Pulse fleet verification unavailable. No scan was deleted; reconnect Pulse and retry.');
 const door=String(draft.doorText||localDoor||raw.door||'').trim();
 const site=String(draft.location||'').trim();
 if(!door||!site||!/[0-9]/.test(door))throw Error('Enter a readable machine door number and site before Pulse fleet verification. No scan was deleted.');
 const key=fleetDoorKey(door);
 const matches=rows.filter(row=>fleetDoorKey(row.door||row.doorNo||row.equipmentDoorNo||equipmentDoorNumber(row))===key);
 if(matches.length>1)throw Error('Pulse has duplicate machine identifiers for '+door+'. Resolve the Equipment Master duplicates before saving. No scan was deleted.');
 const current=matches[0]?.currentLocation||matches[0]?.location||matches[0]?.site||'';
 if(matches.length&&canonicalSiteName(tripCardLocation(current))===canonicalSiteName(tripCardLocation(site)))return null;
 return {door,selectedSite:site,pulseSite:matches.length?current||'Unassigned':'Not registered',reason:matches.length?'transfer-required':'unknown-machine',message:'Card deleted: machine '+door+' is '+(matches.length?'assigned in Pulse to '+(current||'no site'):'not registered in Pulse')+'; selected mine: '+site+'. '+(matches.length?'Complete its transfer':'Register the machine and assign it')+' in Pulse, sync Equipment Master, then upload this card again.'};
}
