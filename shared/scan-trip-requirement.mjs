export function scanTripsOptional(door){
 return /^(?:WT|T|B|M)[ ._/-]*\d+(?=$|[ ._/-])/i.test(String(door??'').trim());
}
