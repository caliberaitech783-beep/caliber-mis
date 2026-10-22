// Expand only explicit fleet labels; never infer a door from a model or registration.
export function fleetDoorKey(value){
 const text=String(value||'').trim().toUpperCase();
 const brand=text.match(/^(SCANIA|VOLVO)\s*[-/]?\s*(\d+)(?=$|[\s-])/);
 if(brand)return (brand[1]==='SCANIA'?'S':'V')+brand[2];
 const short=text.match(/^([A-Z]{1,5})\s*[-/]?\s*(\d+)(?=$|[\s-])/);
 return short?short[1]+short[2]:text.replace(/[^A-Z0-9]/g,'');
}
