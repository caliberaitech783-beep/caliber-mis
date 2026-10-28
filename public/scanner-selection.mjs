export function organizationScanners(devices=[]){
 // Windows WIA has already enumerated scanner devices; do not filter by model.
 return devices.filter(device=>device&&typeof device.id==='string'&&device.id.trim());
}
export function chooseConnectedScanner(devices=[],current='',previousIds){
 const supported=organizationScanners(devices);
 if(supported.some(device=>device.id===current))return current;
 const added=previousIds?supported.filter(device=>!previousIds.includes(device.id)):[];
 return (added.length===1?added[0]:supported[0])?.id||'';
}
export function scannerConnectionMessage(devices=[],selected=''){
 const supported=organizationScanners(devices),device=supported.find(device=>device.id===selected);
 if(!supported.length)return 'No Windows scanner detected. Check scanner power, connection and the Windows WIA driver, then refresh scanners.';
 return `${device?.name||supported[0].name} connected. ${supported.length>1?supported.length+' scanners detected; choose the scanner to use. ':''}Place your document in the scanner, then click Scan.`;
}
