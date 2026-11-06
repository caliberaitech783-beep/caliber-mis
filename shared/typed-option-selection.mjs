const normalized=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export function exactTypedOption(query,options,textFor=option=>option?.label??option?.value??''){
 const needle=normalized(query);
 if(!needle)return null;
 const exact=(options||[]).filter(option=>{
  const text=normalized(textFor(option));
  if(text===needle)return true;
  return /^\d+$/.test(needle)&&text.match(/\d+/g)?.includes(needle);
 });
 return exact.length===1?exact[0]:null;
}
