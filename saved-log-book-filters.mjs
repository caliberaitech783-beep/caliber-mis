export function savedLogBookFilters(query={}){
  const invalid=message=>{throw Object.assign(new Error(message),{status:400})};
  const date=(value,label)=>{
    if(!value)return null;
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)invalid('Enter a valid '+label+' date.');
    return value;
  };
  const from=date(query.from,'start'),to=date(query.to,'end');
  if(from&&to&&from>to)invalid('Start date must be on or before end date.');
  for(const key of ['search','location'])if(query[key]!=null&&typeof query[key]!=='string')invalid('Invalid saved log book filter.');
  const search=String(query.search||'').trim().slice(0,200);
  return {from,to,location:String(query.location||'').trim().slice(0,200),search:search?'%'+search.replace(/[\\%_]/g,'\\$&')+'%':null};
}
