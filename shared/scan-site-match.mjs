import {canonicalSiteName} from './site-location.mjs';
// Trip Card display only. Do not rename masters or rewrite stored records.
export const tripCardLocation=value=>String(value??'').replace(/\boc\b/gi,'OB');
export function tripCardLocationChoices(sites=[],current='',enabled=false){
 return [...new Set([...sites.map(site=>enabled?tripCardLocation(site):site),...(current?[current]:[])])];
}
const base=s=>canonicalSiteName(s).replace(/[^a-z0-9]/g,'').replace(/(?:ob|oc|of|or)(?:2nd)?$/,'');
const distance=(a,b)=>{let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next[j+1]=Math.min(next[j]+1,row[j+1]+1,row[j]+(a[i]!==b[j]));row=next;}return row[b.length];};
const compact=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'').replace(/^(?:site|location)/,'');
// Scan-only aliases: return the existing master label, never a made-up site or
// a global authorization alias. East and West are separate operational sites.
const dchTargets={east:['Dudhichua East OC','Dudichua East OC'],west:['Dudhichua OC','Dudichua OC']};
export const hasDchLocation=readings=>readings.filter(Boolean).some(value=>compact(value).startsWith('dch'));
function matchDchSite(readings,sites){
 const abbreviated=readings.map(compact).filter(value=>value.startsWith('dch'));
 if(!abbreviated.length)return null;
 const directions=new Set();
 for(const value of abbreviated){
  if(value==='dch')continue;
  const match=/^dch(east|west)(?:oc|ob)?$/.exec(value);
  if(!match)return ''; // Partial, conflicting or unreadable direction.
  directions.add(match[1]);
 }
 if(directions.size!==1)return '';
 const direction=[...directions][0],targets=dchTargets[direction].map(canonicalSiteName);
 const matches=sites.filter(site=>targets.includes(canonicalSiteName(site)));
 if(matches.length!==1)return '';
 // A second clear reading of another master location needs human checking.
 if(readings.some(reading=>sites.some(site=>canonicalSiteName(site)===canonicalSiteName(reading)&&canonicalSiteName(site)!==canonicalSiteName(matches[0]))))return '';
 return matches[0];
}
export function matchScannedSite(readings,sites){
 const unique=[...new Map(sites.filter(Boolean).map(s=>[canonicalSiteName(s),s])).values()];
 const dch=matchDchSite(readings.filter(Boolean),unique);if(dch!==null)return dch;
 for(const reading of readings.filter(Boolean)){const exact=unique.filter(s=>canonicalSiteName(s)===canonicalSiteName(reading));if(exact.length===1)return exact[0];}
 const scores=unique.map(site=>({site,score:Math.min(...readings.filter(Boolean).map(r=>base(r).length>=6?distance(base(r),base(site)):99))})).sort((a,b)=>a.score-b.score);
 return scores[0]?.score<=1&&scores[0].score<(scores[1]?.score??99)?scores[0].site:'';
}
