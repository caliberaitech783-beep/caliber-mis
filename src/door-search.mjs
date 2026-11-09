import {canonicalSiteName} from '../shared/site-location.mjs';
import {fleetDoorKey} from '../shared/scan-fleet-door.mjs';
import {allowsLogBookKind} from '../shared/equipment-kind.mjs';
export function doorLabel(asset){const label=String(asset.door||asset.registration||asset.name||'').trim(),name=String(asset.name||'').trim();return name&&name!==label?label+' · '+name:label;}
export function searchSiteDoors(records,kind,location,query=''){
 if(!location)return [];
 const site=canonicalSiteName(location),prefix=fleetDoorKey(query,kind);
 const numeric=/^\d+$/.test(String(query||'').trim());
 return records.filter(r=>{const key=fleetDoorKey(r.door||r.name||r.registration,kind);return allowsLogBookKind(r,kind)&&r.site&&canonicalSiteName(r.site)===site&&(key.startsWith(prefix)||numeric&&key.match(/\d+/g)?.some(part=>part.startsWith(prefix)))})
  .sort((a,b)=>doorLabel(a).localeCompare(doorLabel(b),undefined,{numeric:true,sensitivity:'base'}));
}
