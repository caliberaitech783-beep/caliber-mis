import {canonicalSiteName} from './site-location.mjs';
// Expand only explicit fleet labels; never infer a door from a model or registration.
export function fleetDoorKey(value){
 const text=String(value||'').trim().toUpperCase();
 const brand=text.match(/^(SCANIA|VOLVO)\s*[-/]?\s*(\d+)(?=$|[\s-])/);
 if(brand)return (brand[1]==='SCANIA'?'S':'V')+brand[2].replace(/^0+(?=\d)/,'');
 const short=text.match(/^([A-Z]{1,5})\s*[-/]?\s*(\d+)(?=$|[\s-])/);
 return short?short[1]+short[2].replace(/^0+(?=\d)/,''):text.replace(/[^A-Z0-9]/g,'');
}

// Match only an unambiguous fleet identifier within the selected location/type.
export function linkedScanEquipment(rows=[],door,site='',kind='vehicle'){
 const target=fleetDoorKey(door);if(!target)return null;
 const matches=rows.filter(r=>(!kind||r.kind===kind)&&(!site||canonicalSiteName(r.site)===canonicalSiteName(site))&&[r.door,r.doorNo,r.registration,r.reg,r.name,r.equipmentName].some(value=>value&&fleetDoorKey(value)===target));
 return matches.length===1?matches[0]:null;
}
