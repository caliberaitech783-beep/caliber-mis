import {allowsLogBookKind} from '../shared/equipment-kind.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
export function logBookAssets(options,kind,location){
 return (options?.assets||[]).filter(asset=>allowsLogBookKind(asset,kind)&&(!location||!asset.site||canonicalSiteName(asset.site)===canonicalSiteName(location)));
}
export function missingAssetMessage(options,kind,location){
 if(!options)return 'Loading Equipment Master…';
 if(!options.assets?.length)return 'Equipment Master is empty in this MIS database. Sync Equipment Master, then reload doors.';
 const type=kind==='lmv'?'LMVs':kind==='vehicle'?'vehicles':'equipment';
 if(!options.assets.some(asset=>allowsLogBookKind(asset,kind)))return 'No '+type+' are available in Equipment Master. Check the vehicle/equipment category, then reload doors.';
 if(!logBookAssets(options,kind,location).length)return 'No '+type+' are assigned to '+location+'. Check Current Location in Equipment Master, then reload doors.';
 return '';
}
