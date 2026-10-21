import {canonicalSiteName} from './site-location.mjs';
const base=s=>canonicalSiteName(s).replace(/[^a-z0-9]/g,'').replace(/(?:ob|oc|of|or)(?:2nd)?$/,'');
const distance=(a,b)=>{let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next[j+1]=Math.min(next[j]+1,row[j+1]+1,row[j]+(a[i]!==b[j]));row=next;}return row[b.length];};
export function matchScannedSite(readings,sites){
 const unique=[...new Map(sites.filter(Boolean).map(s=>[canonicalSiteName(s),s])).values()];
 for(const reading of readings.filter(Boolean)){const exact=unique.filter(s=>canonicalSiteName(s)===canonicalSiteName(reading));if(exact.length===1)return exact[0];}
 const scores=unique.map(site=>({site,score:Math.min(...readings.filter(Boolean).map(r=>base(r).length>=6?distance(base(r),base(site)):99))})).sort((a,b)=>a.score-b.score);
 return scores[0]?.score<=1&&scores[0].score<(scores[1]?.score??99)?scores[0].site:'';
}
