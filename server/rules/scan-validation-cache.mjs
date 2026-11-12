// Read-only master and equipment alias lookups share one result during a single batch validation.
// Do not cache card checks, permissions, writes, or results across requests.
export function scanValidationClient(client){
 const reads=new Map();
 return {query(sql,args=[]){
  const masterRead=/\bFROM\s+master_records\b/i.test(sql);
  const aliasRead=/^SELECT a\.\*,.* FROM mis_equipment_aliases a /i.test(sql)
   || /^SELECT to_regclass\('(?:mis_equipment_aliases|pulse_master_links)'\) IS NOT NULL AS present$/i.test(sql);
  if(!/^\s*SELECT\b/i.test(sql)||!(masterRead||aliasRead)||/\bFOR\s+(?:UPDATE|SHARE)\b/i.test(sql))return client.query(sql,args);
  const key=sql+'\\0'+JSON.stringify(args);
  if(!reads.has(key))reads.set(key,Promise.resolve().then(()=>client.query(sql,args)));
  return reads.get(key);
 }};
}
