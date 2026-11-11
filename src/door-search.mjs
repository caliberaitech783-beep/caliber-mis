import {canonicalSiteName} from '../shared/site-location.mjs';
import {fleetDoorKey} from '../shared/scan-fleet-door.mjs';
import {allowsLogBookKind} from '../shared/equipment-kind.mjs';
const lmvIdentifiers=asset=>[asset.lmvDoor??asset.door,asset.registration]
 .map(value=>String(value??'').trim())
 .filter(value=>value&&!/^(?:[-–—]+|n\/?a|none|unknown|null|not available|not applicable)$/i.test(value));
export function doorLabel(asset,kind){
 if(kind==='lmv')return [...new Set(lmvIdentifiers(asset))].join(' · ');
 const label=String(asset.door||asset.registration||asset.name||'').trim(),name=String(asset.name||'').trim();return name&&name!==label?label+' · '+name:label;}
export function searchSiteDoors(records,kind,location,query=''){
 if(!location)return [];
 const site=canonicalSiteName(location),prefix=fleetDoorKey(query,kind);
 const numeric=/^\d+$/.test(String(query||'').trim());
 const matches=key=>key.startsWith(prefix)||numeric&&key.match(/\d+/g)?.some(part=>part.startsWith(prefix));
 return records.filter(r=>allowsLogBookKind(r,kind)&&r.site&&canonicalSiteName(r.site)===site&&
  (kind==='lmv'?lmvIdentifiers(r).some(value=>matches(fleetDoorKey(value,kind))):matches(fleetDoorKey(r.door||r.name||r.registration,kind))))
  .sort((a,b)=>doorLabel(a,kind).localeCompare(doorLabel(b,kind),undefined,{numeric:true,sensitivity:'base'}));
}
