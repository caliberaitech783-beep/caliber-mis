export function chooseConnectedScanner(devices=[],current='',previousIds){
 const added=previousIds?devices.filter(d=>!previousIds.includes(d.id)):[];
 if(added.length===1)return added[0].id;
 return devices.some(d=>d.id===current)?current:devices[0]?.id||'';
}
export function captureScanner(devices=[],requested){
 return devices.find(d=>d.id===requested)||(devices.length===1?devices[0]:null);
}
