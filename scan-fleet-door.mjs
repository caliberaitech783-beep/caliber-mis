import {identifyCardMachine,matchCardMachine} from './scan-machine-rules.mjs';
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
