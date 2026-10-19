export async function readScannerResponse(response){
 const text=await response.text();let data;
 try{data=JSON.parse(text)}catch{throw new Error(response.status===401?'Your session expired. Sign in again.':'The local scanner service is starting or reconnecting. This page will retry automatically.');}
 if(!response.ok)throw new Error(data?.error||'The local scanner service is unavailable.');
 if(!data||typeof data!=='object')throw new Error('The local scanner service returned an invalid response. Refresh scanners to retry.');
 return data;
}
