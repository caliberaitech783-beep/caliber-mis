export {chooseConnectedScanner,organizationScanners,scannerConnectionMessage} from './public/scanner-selection.mjs';
export function captureScanner(devices=[],requested){
 return devices.find(d=>d.id===requested)||(devices.length===1?devices[0]:null);
}
