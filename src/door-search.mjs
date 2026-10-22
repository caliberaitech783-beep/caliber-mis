import {canonicalSiteName} from '../site-location.mjs';
import {fleetDoorKey} from '../scan-fleet-door.mjs';
export function doorLabel(asset){const label=String(asset.door||asset.registration||asset.name||'').trim(),name=String(asset.name||'').trim();return name&&name!==label?label+' · '+name:label;}
export function searchSiteDoors(records,kind,location,query=''){
 if(!location)return [];
 const site=canonicalSiteName(location),prefix=fleetDoorKey(query);
 return records.filter(r=>r.kind===kind&&r.site&&canonicalSiteName(r.site)===site&&fleetDoorKey(r.door||r.name||r.registration).startsWith(prefix))
  .sort((a,b)=>doorLabel(a).localeCompare(doorLabel(b),undefined,{numeric:true,sensitivity:'base'}));
}
