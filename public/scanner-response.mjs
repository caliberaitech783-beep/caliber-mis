export async function readConnectorResponse(response){
 let text;try{text=await response.text();}catch{throw Error('The local scanner response was interrupted. Close this window and reconnect from online MIS. Your saved scans are retained.');}
 let data;try{data=JSON.parse(text);}catch{throw Error('The local scanner service is starting or reconnecting. Wait a few seconds, then close this window and click Connect PC scanner again. Your saved scans are retained.');}
 if(!response.ok)throw Error(data?.error||'The local scanner service is unavailable. Reconnect from online MIS.');
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('The local scanner returned an invalid response. Reconnect from online MIS.');
 return data;
}
export async function waitForScannerService(fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 for(let attempt=0;attempt<3;attempt++){
  try{const response=await fetchImpl('/api/health',{cache:'no-store',signal:AbortSignal.timeout(5000)});await response.body?.cancel?.();if(response.ok)return;}catch{}
  if(attempt<2)await sleep(1000);
 }
 throw Error('The local scanner service is not ready. Start Local MIS, then reconnect from online MIS.');
}
