// Read-only master lookups share one result during a single batch validation.
// Do not cache card checks, permissions, writes, or results across requests.
export function scanValidationClient(client){
 const reads=new Map();
 return {query(sql,args=[]){
  if(!/^\s*SELECT\b/i.test(sql)||! /\bFROM\s+master_records\b/i.test(sql)||/\bFOR\s+(?:UPDATE|SHARE)\b/i.test(sql))return client.query(sql,args);
  const key=sql+'\\0'+JSON.stringify(args);
  if(!reads.has(key))reads.set(key,Promise.resolve().then(()=>client.query(sql,args)));
  return reads.get(key);
 }};
}
