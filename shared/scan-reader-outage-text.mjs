// Plain words for a reading-account outage and for cards that could not be read.
// The scan screen and the administrators' alert say the same thing, and always
// say first whose problem it is: the reading account, not the person scanning.
const OUTAGES={
 billing:{title:'Card reading is stopped: the Google reading account has no credit.',action:'The administrator must add credit in Google AI Studio (Billing) and switch on auto-reload.',short:'the Google reading account had no credit'},
 key:{title:'Card reading is stopped: Google refused the reading key.',action:'The administrator must check the Gemini key of this server.',short:'Google refused the reading key'},
 quota:{title:'Card reading is paused: the Google reading limit is reached.',action:'Reading restarts by itself when Google allows more.',short:'the Google reading limit was reached'},
};
const NOT_YOUR_MISTAKE='This is not a scanning mistake.';

// The banner on the scan screen while a site's cards are held.
export function readerOutageMessage(outage){
 const words=OUTAGES[outage?.reason];
 if(!words)return '';
 return `${words.title} ${NOT_YOUR_MISTAKE} Your cards are safe and will be read automatically when reading restarts; do not scan them again. ${words.action}`;
}

// The message for the administrators' group.
export function readerOutageAlert(outage){
 const words=OUTAGES[outage?.reason];
 if(!words)return '';
 const site=!outage.lane||outage.lane==='*'?'all sites':outage.lane;
 return ['Caliber Pulse-II • Card scanning',words.title,`Site queue: ${site}${outage.httpStatus?' · Google reply: HTTP '+outage.httpStatus:''}`,outage.detail?'Google says: '+outage.detail:'',words.action,'Cards already uploaded are kept and are read automatically when reading restarts.'].filter(Boolean).join('\n');
}

// Why the cards under "Error" could not be read, most cards first:
// [{reason, count, account}] where account = a reading-account failure.
export function scanErrorReasons(cards){
 const found=new Map();
 const add=(reason,account)=>{const row=found.get(reason)||{reason,count:0,account};row.count++;found.set(reason,row);};
 for(const card of cards||[]){
  if(card.status==='rejected'||['queued','reading','posted'].includes(card.status))continue;
  if(card.status!=='error'){if(card.context_mismatch?.length)add(String(card.context_mismatch[0]),false);continue;}
  const text=String(card.error||''),status=Number(/Gemini extraction failed \(HTTP (\d{3})\)/.exec(text)?.[1])||0;
  const words=status===402?OUTAGES.billing:status===429?OUTAGES.quota:[401,403].includes(status)?OUTAGES.key:null;
  if(words)add(`Not a scanning mistake: ${words.short} (HTTP ${status}). The cards are kept and are read again when reading restarts.`,true);
  else if(/scanned on the (?:VLB|ELB) page/.test(text))add('Wrong page: a VLB card was scanned on the ELB page, or an ELB card on the VLB page.',false);
  else add(text?text.split(/(?<=\.)\s/)[0].slice(0,160):'The card could not be read.',false);
 }
 return [...found.values()].sort((a,b)=>b.count-a.count);
}
