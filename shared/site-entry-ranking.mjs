// Dashboard site comparison order: the site with the fewest saved cards comes first, the best site last.
// Only the logbook kinds this login may see are counted; equal totals fall back to the site name.
export function sitesLowToHigh(bySite=[],kinds=['vehicle','equipment']){
 const total=row=>kinds.reduce((sum,kind)=>sum+Number(row[kind]||0),0);
 return [...bySite].sort((a,b)=>total(a)-total(b)||String(a.site).localeCompare(String(b.site)));
}
