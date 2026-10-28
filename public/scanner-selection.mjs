export function organizationScanners(devices=[]){
 return devices.filter(device=>{
  const name=String(device.name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  return /brother.*ads3100(?!\d)/.test(name)||/canon.*drc225(?:ii|2)(?!i|[0-9])/.test(name);
 });
}
export function chooseConnectedScanner(devices=[],current='',previousIds){
 const supported=organizationScanners(devices);
 if(supported.some(device=>device.id===current))return current;
 const added=previousIds?supported.filter(device=>!previousIds.includes(device.id)):[];
 return (added.length===1?added[0]:supported[0])?.id||'';
}
export function scannerConnectionMessage(devices=[],selected=''){
 const supported=organizationScanners(devices),device=supported.find(device=>device.id===selected);
 if(!supported.length)return 'No Brother ADS-3100 or Canon DR-C225II detected. Check scanner power, USB connection and the Windows WIA driver, then refresh scanners.';
 return `${device?.name||supported[0].name} connected. ${supported.length>1?'Both organization scanners are detected; choose the scanner to use. ':''}Load the feeder, then click Scan.`;
}
