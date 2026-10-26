export const SCANNER_UNAVAILABLE='The PC scanner connector could not be reached on this computer. Ask your site IT team to install and start the Caliber local scanner backend and UI on the Windows PC connected to the scanner, then retry. Allow local network access if your browser asks. You can also scan with the scanner software and use Upload files to send the PDF or images directly to online MIS.';

export async function checkScannerAvailability(fetchImpl=fetch){
 try{
  // Cross-origin no-cors requests require redirect mode "follow", even without
  // a redirect. This plain-text marker checks reachability only; the connector
  // still requires its one-time ticket before granting any scanner access.
  const response=await fetchImpl('http://127.0.0.1:4174/scanner-ready.txt',{mode:'no-cors',credentials:'omit',cache:'no-store',redirect:'follow',targetAddressSpace:'loopback',signal:AbortSignal.timeout(8000)});
  await response.body?.cancel?.();
  if(response.type!=='opaque'&&!response.ok)throw Error('Connector unavailable');
 }catch{throw Error(SCANNER_UNAVAILABLE);}
}
