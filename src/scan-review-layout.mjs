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
 if(missing)return 'Enter '+missing[1].toLowerCase()+'.';
 const master=/^(Equipment|Employee|Shift|Work Contract) Master is empty in this MIS database\. Sync\/import it before matching scans\.$/i.exec(text);
 if(master)return master[1]+' master is empty.';
 const required=/^(.+) (?:is missing or unreadable|is required)\.$/.exec(text);
 if(required)return 'Enter '+required[1].toLowerCase()+'.';
 if(/^Check the flagged extraction (?:response )?issues /.test(text))return 'Check the highlighted fields and confirm corrections.';
 if(text==='Extracted from handwriting: check this field against the original card.')return 'Check this value.';
 if(text==='Handwritten reading: compare this value with the reading table and confirm or correct it.')return 'Check this reading.';
 if(text.startsWith('Book Date could not be read.'))return 'Enter the card date.';
 if(text.startsWith('Book date was not read from the scan;'))return 'Check the card date.';
 if(text==='Printed machine-wise summary was not read. Compare the calculated totals with the paper summary.')return 'Check the equipment trip totals.';
 if(text==='No trip rows extracted. Add all trip rows, or explicitly confirm the card has no trips.')return 'Add trip rows, or confirm no trips.';
 return text.replace(/\s+(?:from|against) (?:the )?(?:original (?:trip )?card|original scan|scanned card|scan)\b/gi,'');
}

export function scanTripPageSize(height){
 return height>=850?5:height>=700?3:2;
}

export function scanTripReviewPage(length,page=0,size=4){
 const pages=Math.max(1,Math.ceil(length/size));
 const current=Math.max(0,Math.min(page,pages-1));
 return {page:current,pages,size,start:current*size,end:Math.min(length,(current+1)*size)};
}
