export const SCAN_REVIEW_TABS=[['details','Details'],['trips','Trips'],['summary','Summary']];

export function scanReviewTabForKey(id,key){
 const index=Math.max(0,SCAN_REVIEW_TABS.findIndex(tab=>tab[0]===id));
 if(key==='Home')return SCAN_REVIEW_TABS[0][0];
 if(key==='End')return SCAN_REVIEW_TABS.at(-1)[0];
 if(!['ArrowLeft','ArrowRight'].includes(key))return null;
 return SCAN_REVIEW_TABS[(index+(key==='ArrowRight'?1:2))%3][0];
}

export function scanReviewFieldSection(key){
 return ['openingKmr','closingKmr','openingHmr','closingHmr'].includes(key)?'summary':'details';
}

export function scanReviewHelp(message){
 const text=String(message||'');
 const missing=/^(.+) needs checking: enter the value from the scan\.$/.exec(text);
 if(missing)return 'Enter '+missing[1].toLowerCase()+' from scan.';
 const master=/^(Equipment|Employee|Shift|Work Contract) Master is empty in this MIS database\. Sync\/import it before matching scans\.$/i.exec(text);
 if(master)return master[1]+' master is empty.';
 return text;
}

export function scanTripPageSize(height){
 return height>=1000?4:height>=800?3:2;
}

export function scanTripReviewPage(length,page=0,size=4){
 const pages=Math.max(1,Math.ceil(length/size));
 const current=Math.max(0,Math.min(page,pages-1));
 return {page:current,pages,size,start:current*size,end:Math.min(length,(current+1)*size)};
}
