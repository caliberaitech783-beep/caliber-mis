import {cardMachineKey,identifyCardMachine,matchCardMachine,separatorCorrectedKey} from './scan-machine-rules.mjs';
// Expand only explicit fleet labels; never infer a door from a model or registration.
export function fleetDoorKey(value,kind='vehicle'){
 const rule=identifyCardMachine(value,kind,{allowSuffix:true});if(rule)return rule.key||rule.code;
 const text=String(value||'').trim().toUpperCase();
 const brand=text.match(/^(SCANIA|VOLVO)\s*[-/]?\s*(\d+)(?=$|[\s-])/);
 if(brand)return (brand[1]==='SCANIA'?'S':'V')+brand[2].replace(/^0+(?=\d)/,'');
 const short=text.match(/^([A-Z]{1,5})\s*[-/]?\s*(\d+)(?=$|[\s-])/);
 return short?short[1]+short[2].replace(/^0+(?=\d)/,''):text.replace(/[^A-Z0-9]/g,'');
}

// Match only an unambiguous fleet identifier within the selected location/type.
export function linkedScanEquipment(rows=[],door,site='',kind='vehicle'){
 return matchCardMachine(rows.filter(row=>!kind||row.kind===kind),door,site,kind||'vehicle').match;
}

// True when the linked door is the written one with its slash read as a 1
// (card V/840 read as V1840, linked door V-840). matchCardMachine only links
// that way when no door answers the read number, so the 1 was never a digit.
export function separatorLinkedScanDoor(asset,written,kind='vehicle'){
 const canonical=String(asset?.door||asset?.doorNo||asset?.registration||'').trim();
 const corrected=separatorCorrectedKey(written,kind);
 return Boolean(canonical&&corrected&&cardMachineKey(canonical,kind)===corrected&&cardMachineKey(written,kind)!==corrected);
}

// The draft fields for a door linked through a slash read as 1: the real door in
// the box, the card's own writing kept beside it (as alias pairing does).
export function separatorDoorFields(asset,written,kind='vehicle'){
 if(!separatorLinkedScanDoor(asset,written,kind))return {};
 return {doorText:String(asset.door||asset.doorNo||asset.registration).trim(),doorTextWritten:String(written||'').trim()};
}

// Once an exact normalized OCR key matches a master record, show and save the
// master's canonical label. So does a slash read as 1 (V1840 for V/840): the
// door box, the Pulse site check and the reports then use the real door.
// Recovery that changes digits keeps the scan text.
export function canonicalLinkedScanDoor(asset,written,kind='vehicle'){
 const canonical=String(asset?.door||asset?.doorNo||asset?.registration||'').trim();
 return canonical&&(fleetDoorKey(canonical,kind)===fleetDoorKey(written,kind)||separatorLinkedScanDoor(asset,written,kind))?canonical:written;
}
