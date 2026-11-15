// Smart search for the Pulse-II menu, built on the same word matching as Pulse 1
// (shared/smart-search.mjs): any word order, case and brackets ignored, joined
// words found ("lmvlog"). On top of that it knows the short forms people type
// (VLB, ELB, OT, BD), matches a page's initials ("cb" = Create Batch), ranks the
// best match first, and as a last resort accepts letters typed in order ("crtbtch").
import {normalizeSearchText} from '../shared/smart-search.mjs';

const SHORT_FORMS={
  vlb:['vehicle log book'],elb:['equipment log book'],lmv:['lmv log book','light motor vehicle'],
  ot:['overtime','manpower'],bd:['breakdown'],wa:['whatsapp'],tg:['telegram'],
  hr:['manpower','attendance','employee'],emp:['employee'],eq:['equipment'],equip:['equipment'],
  login:['login details','users'],user:['login details','users'],users:['login details'],
  scan:['bulk scan','trip card','job card'],trip:['trip card','vehicle log book'],job:['job card','equipment log book'],
  delete:['deletion'],remove:['deletion'],backup:['backup'],sync:['sync all masters'],
};

export const acronymOf=text=>normalizeSearchText(String(text).replace(/\([^)]*\)/g,' ')).split(' ').filter(Boolean).map(word=>word[0]).join('');

const subsequence=(needle,haystack)=>{let at=0;for(const ch of haystack){if(ch===needle[at])at++;if(at===needle.length)return true;}return needle.length===0;};

// One query word against one page; returns a score (0 = no match).
function wordScore(word,entry){
  const singular=word.length>3&&word.endsWith('s')?word.slice(0,-1):'';
  const choices=[word,...(singular?[singular]:[]),...(SHORT_FORMS[word]||[])];
  let best=0;
  for(const choice of choices){
    const weight=choice===word?1:choice===singular?.9:.7;
    const labelWords=entry.labelText.split(' ');
    let score=0;
    if(entry.acronym===choice&&choice.length>1)score=60;
    else if(labelWords.some(w=>w===choice))score=50;
    else if(labelWords.some(w=>w.startsWith(choice)))score=40;
    else if(entry.labelText.includes(choice)||entry.labelCompact.includes(choice.replaceAll(' ','')))score=30;
    else if(entry.keywordText.includes(choice))score=22;
    else if(entry.acronym.startsWith(choice)&&choice.length>1)score=20;
    else if(entry.pathText.includes(choice)||entry.pathCompact.includes(choice.replaceAll(' ','')))score=10;
    best=Math.max(best,score*weight);
  }
  return best;
}

export function prepareMenuEntry(entry){
  const labelText=normalizeSearchText(entry.label),pathText=normalizeSearchText(entry.path||[]);
  return {...entry,labelText,labelCompact:labelText.replaceAll(' ',''),acronym:acronymOf(entry.label),pathText,pathCompact:pathText.replaceAll(' ',''),keywordText:normalizeSearchText(entry.keywords||[])};
}

export function searchMenu(query,entries){
  const words=normalizeSearchText(query).split(' ').filter(Boolean);
  if(!words.length)return [];
  const prepared=entries.map(entry=>entry.labelText===undefined?prepareMenuEntry(entry):entry);
  const whole=words.join(' ');
  let results=prepared.map((entry,order)=>{
    const scores=words.map(word=>wordScore(word,entry));
    if(scores.some(score=>!score))return null;
    let score=scores.reduce((a,b)=>a+b,0);
    if(entry.labelText===whole||(entry.acronym===whole.replaceAll(' ','')&&whole.length>1))score+=100;else if(entry.labelText.startsWith(whole))score+=45;
    return {entry,score,order};
  }).filter(Boolean);
  if(!results.length){
    const typed=words.join('');
    if(typed.length>=3)results=prepared.map((entry,order)=>subsequence(typed,entry.labelCompact)?{entry,score:5,order,loose:true}:null).filter(Boolean);
  }
  return results.sort((a,b)=>b.score-a.score||a.order-b.order).map(({entry,score,loose})=>({...entry,score,loose:Boolean(loose)}));
}

// Character ranges of the label to highlight for the typed words.
export function highlightRanges(label,query){
  const lower=String(label).toLowerCase(),ranges=[];
  for(const word of normalizeSearchText(query).split(' ').filter(Boolean)){
    let at=lower.indexOf(word);
    while(at>=0){ranges.push([at,at+word.length]);at=lower.indexOf(word,at+word.length);}
  }
  ranges.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const range of ranges){const last=merged[merged.length-1];if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
  return merged;
}
